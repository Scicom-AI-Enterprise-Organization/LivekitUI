'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AudioPresets,
  ConnectionState,
  createLocalAudioTrack,
  LocalAudioTrack,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import {
  AGENT_NAME_ATTRIBUTE,
  AGENT_TRACK,
  CHAT_ROLE_ATTRIBUTE,
  CHAT_TOPIC,
  CUSTOMER_NAME_ATTRIBUTE,
  CUSTOMER_TRACK,
  isRole,
  roleFromTrackName,
  ROLE_LABEL,
  SUGGESTION_TOPIC,
  TRANSCRIPT_TOPIC,
  type PublishedLeg,
  type Publisher,
  type Role,
  type Suggestion,
  type TranscriptLine,
} from './types';

/** `idle` — the join form. `joined` — in the room, publishing or just watching. */
export type Phase = 'idle' | 'connecting' | 'joined';

/** Enough scrollback to follow a call without growing without bound. */
const MAX_TRANSCRIPT_LINES = 400;
const MAX_SUGGESTIONS = 8;

interface JoinArgs {
  name: string;
  customer: string;
  room: string;
}

/** A remote audio track we are playing, with whatever we can say about it. */
export interface RemoteLeg {
  key: string;
  label: string;
  role: Role | null;
  track: MediaStreamTrack;
}

export interface DualCall {
  phase: Phase;
  error: string | null;
  connecting: boolean;
  me: { identity: string; name: string; customer: string } | null;
  /** Everyone in the room and what each of them has on air. */
  publishers: Publisher[];
  workerPresent: boolean;
  /** Why the worker is not here, or not transcribing, when something could say. */
  workerError: string | null;
  transcript: TranscriptLine[];
  suggestions: Suggestion[];

  /** The support agent's leg — our microphone, published as `agent_audio`. */
  micEnabled: boolean;
  micError: string | null;
  micTrack: MediaStreamTrack | null;
  /** The customer's leg — captured screen/tab audio, published as `customer_audio`. */
  customerLive: boolean;
  customerError: string | null;
  customerTrack: MediaStreamTrack | null;
  /** Both legs on air: what the worker needs to transcribe a whole call. */
  onAir: boolean;

  /** Audio published by *someone else* — what a monitor hears and meters. */
  remoteLegs: RemoteLeg[];

  join: (args: JoinArgs) => Promise<void>;
  leave: () => void;
  toggleMic: () => Promise<void>;
  shareCustomerAudio: () => Promise<void>;
  stopCustomerAudio: () => Promise<void>;
  sendMessage: (text: string, role: Role) => Promise<void>;
  /** Ask the server to dispatch the worker into a room that already exists. */
  retryWorker: () => Promise<void>;
}

function publisherOf(p: Participant): Publisher {
  const legs: PublishedLeg[] = [];
  p.trackPublications.forEach((pub) => {
    if (pub.kind !== Track.Kind.Audio) return;
    legs.push({
      trackSid: pub.trackSid,
      trackName: pub.trackName || String(pub.source),
      source: String(pub.source),
      role: roleFromTrackName(pub.trackName),
      muted: pub.isMuted,
    });
  });
  return {
    identity: p.identity,
    name: p.attributes?.[AGENT_NAME_ATTRIBUTE] || p.name || p.identity,
    legs,
  };
}

/**
 * @param audioContainer where subscribed audio elements are appended. It is the
 * caller's ref, not one handed back in the return value: returning a ref would
 * make every read of this hook's result a ref access during render.
 */
export function useDualCall(audioContainer: React.RefObject<HTMLDivElement | null>): DualCall {
  const roomRef = useRef<Room | null>(null);
  const roomNameRef = useRef<string>('');

  /** The microphone leg. Held so mute/unmute does not have to re-acquire it. */
  const micRef = useRef<LocalAudioTrack | null>(null);
  /**
   * The capture the customer leg comes from.
   *
   * The video track is deliberately kept alive and never published. Chrome does
   * not allow an audio-only `getDisplayMedia`, and stopping the video track it
   * insists on handing back can take the whole capture session with it — so the
   * cheapest reliable thing is to hold it, ignore it, and stop it on cleanup. It
   * is also the track whose `ended` event fires when the user presses the
   * browser's own "Stop sharing" button.
   */
  const captureRef = useRef<MediaStream | null>(null);
  /**
   * The raw capture track, not a `LocalAudioTrack`.
   *
   * `publishTrack`/`unpublishTrack` both take a `MediaStreamTrack`, and letting
   * the SDK wrap it keeps us out of `LocalAudioTrack`'s `userProvidedTrack`
   * flag — which decides whether the SDK may stop and restart a track it did not
   * open, and restarting a display capture is not something a browser allows.
   */
  const customerRef = useRef<MediaStreamTrack | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<DualCall['me']>(null);
  const [publishers, setPublishers] = useState<Publisher[]>([]);
  const [workerPresent, setWorkerPresent] = useState(false);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micTrack, setMicTrack] = useState<MediaStreamTrack | null>(null);
  const [customerLive, setCustomerLive] = useState(false);
  const [customerError, setCustomerError] = useState<string | null>(null);
  const [customerTrack, setCustomerTrack] = useState<MediaStreamTrack | null>(null);
  const [remoteLegs, setRemoteLegs] = useState<RemoteLeg[]>([]);

  const releaseCapture = useCallback(() => {
    captureRef.current?.getTracks().forEach((t) => t.stop());
    captureRef.current = null;
    customerRef.current = null;
    setCustomerLive(false);
    setCustomerTrack(null);
  }, []);

  const leave = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    releaseCapture();
    micRef.current = null;
    if (room) void room.disconnect();
    setPhase('idle');
    setMe(null);
    setPublishers([]);
    setWorkerPresent(false);
    setWorkerError(null);
    setTranscript([]);
    setSuggestions([]);
    setMicEnabled(false);
    setMicError(null);
    setMicTrack(null);
    setCustomerError(null);
    setRemoteLegs([]);
  }, [releaseCapture]);

  // Leaving the page mid-call has to drop the participant and stop the capture,
  // or the browser keeps showing a share that nothing is reading.
  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
      captureRef.current?.getTracks().forEach((t) => t.stop());
      captureRef.current = null;
      if (room) void room.disconnect();
    };
  }, []);

  const addLine = useCallback((line: TranscriptLine) => {
    setTranscript((prev) => {
      const at = prev.findIndex((l) => l.id === line.id);
      // A partial is revised in place: the worker re-sends the same id as the
      // utterance grows, and appending each revision would repeat every word.
      const next = at === -1 ? [...prev, line] : prev.map((l, i) => (i === at ? line : l));
      return next.length > MAX_TRANSCRIPT_LINES ? next.slice(-MAX_TRANSCRIPT_LINES) : next;
    });
  }, []);

  const applyTranscript = useCallback(
    (payload: Record<string, unknown>) => {
      // A leg starting is already visible in the room's own track events.
      if (payload.event === 'leg-started') return;

      // The worker saw an audio track it could not place. Nothing downstream will
      // ever transcribe it, and the only symptom otherwise is half a conversation.
      if (payload.event === 'unmatched-track') {
        const track = typeof payload.track === 'string' && payload.track ? payload.track : 'a track';
        const source = typeof payload.source === 'string' ? payload.source : 'unknown source';
        setWorkerError(
          `The worker ignored ${track} (${source}) — its name matches neither "agent" nor "customer", ` +
            `so it cannot tell whose voice it is.`
        );
        return;
      }

      // The worker reporting that its STT (or LLM) is failing. Without this the
      // whole call looks like a capture problem: the worker is in the room, the
      // level meters move, and the transcript stays empty forever.
      if (payload.event === 'error') {
        const source = typeof payload.source === 'string' ? payload.source : 'transcription';
        const detail = typeof payload.error === 'string' ? payload.error : 'failed';
        setWorkerError(`${source} is failing: ${detail}`);
        return;
      }

      const role = payload.role;
      const text = typeof payload.text === 'string' ? payload.text : '';
      if (!isRole(role) || !text.trim()) return;

      addLine({
        id: String(payload.id ?? `${role}-${payload.ts ?? Date.now()}`),
        role,
        name: typeof payload.name === 'string' ? payload.name : ROLE_LABEL[role],
        text,
        final: payload.final !== false,
        ts: typeof payload.ts === 'number' ? payload.ts : Date.now(),
        via: 'voice',
      });
    },
    [addLine]
  );

  const applySuggestion = useCallback((payload: Record<string, unknown>) => {
    const id = String(payload.id ?? '');
    if (!id) return;
    const delta = typeof payload.delta === 'string' ? payload.delta : null;
    const state = typeof payload.state === 'string' ? payload.state : null;

    setSuggestions((prev) => {
      const at = prev.findIndex((s) => s.id === id);
      const current: Suggestion =
        at === -1 ? { id, text: '', state: 'thinking', ts: Date.now() } : prev[at];

      let updated: Suggestion = current;
      if (delta) {
        updated = { ...current, text: current.text + delta, state: 'streaming' };
      } else if (state === 'done') {
        const text = typeof payload.text === 'string' ? payload.text : current.text;
        updated = { ...current, text, state: 'done' };
      } else if (state === 'error') {
        const why = typeof payload.error === 'string' ? payload.error : 'failed';
        updated = { ...current, state: 'error', text: why };
      } else if (state === 'superseded') {
        // Dropped mid-sentence because the customer kept talking. Keeping a
        // half-written note on screen reads as advice; discard it.
        return at === -1 ? prev : prev.filter((s) => s.id !== id);
      } else if (state === 'thinking') {
        updated = { ...current, state: 'thinking' };
      }

      const next = at === -1 ? [...prev, updated] : prev.map((s, i) => (i === at ? updated : s));
      return next.length > MAX_SUGGESTIONS ? next.slice(-MAX_SUGGESTIONS) : next;
    });
  }, []);

  const join = useCallback(
    async ({ name, customer, room: roomName }: JoinArgs) => {
      if (roomRef.current) return;
      setError(null);
      setPhase('connecting');

      try {
        const res = await fetch('/api/connection-details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, customer, room: roomName }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || 'Could not get a token');

        const room = new Room({ adaptiveStream: true, dynacast: true });
        roomRef.current = room;
        roomNameRef.current = data.roomName;
        // The server tried to dispatch the worker as part of handing out this
        // token. If it could not, that is the reason nothing will transcribe, and
        // it belongs on screen rather than in a server log.
        setWorkerError(data.dispatch?.ok === false ? data.dispatch.error || null : null);

        // Typed messages are rendered straight off the chat topic — no worker
        // needed, and no risk of showing a message twice because something
        // echoed it back. The side comes off the stream's own attributes, since
        // one participant carries both voices and the sender's identity cannot
        // say which one typed.
        room.registerTextStreamHandler(CHAT_TOPIC, (reader, participantInfo) => {
          void reader.readAll().then((text) => {
            if (!text.trim()) return;
            const claimed = reader.info.attributes?.[CHAT_ROLE_ATTRIBUTE];
            const role: Role = isRole(claimed) ? claimed : 'agent';
            const sender = room.getParticipantByIdentity(participantInfo.identity);
            const label =
              role === 'customer'
                ? sender?.attributes?.[CUSTOMER_NAME_ATTRIBUTE] || ROLE_LABEL.customer
                : sender?.attributes?.[AGENT_NAME_ATTRIBUTE] ||
                  sender?.name ||
                  ROLE_LABEL.agent;
            addLine({
              id: reader.info.id,
              role,
              name: label,
              text,
              final: true,
              ts: Date.now(),
              via: 'text',
            });
          });
        });

        const refresh = () => {
          const found: Publisher[] = [];
          let worker = false;
          if (room.localParticipant) found.push(publisherOf(room.localParticipant));
          room.remoteParticipants.forEach((p: RemoteParticipant) => {
            // The worker joins as a kind=agent participant and publishes nothing.
            if (p.isAgent) {
              worker = true;
              return;
            }
            found.push(publisherOf(p));
          });
          setPublishers(found);
          setWorkerPresent(worker);
        };

        const legLabel = (pub: RemoteTrackPublication, p: RemoteParticipant): string => {
          const role = roleFromTrackName(pub.trackName);
          if (role === 'customer') {
            return p.attributes?.[CUSTOMER_NAME_ATTRIBUTE] || ROLE_LABEL.customer;
          }
          if (role === 'agent') {
            return p.attributes?.[AGENT_NAME_ATTRIBUTE] || p.name || ROLE_LABEL.agent;
          }
          return pub.trackName || 'Unlabelled track';
        };

        room
          .on(RoomEvent.ParticipantConnected, refresh)
          .on(RoomEvent.ParticipantDisconnected, refresh)
          .on(RoomEvent.ParticipantAttributesChanged, refresh)
          .on(RoomEvent.TrackPublished, refresh)
          .on(RoomEvent.TrackUnpublished, refresh)
          .on(RoomEvent.TrackMuted, refresh)
          .on(RoomEvent.TrackUnmuted, refresh)
          .on(RoomEvent.LocalTrackPublished, refresh)
          .on(RoomEvent.LocalTrackUnpublished, refresh)
          .on(
            RoomEvent.TrackSubscribed,
            (track: RemoteTrack, pub: RemoteTrackPublication, participant: RemoteParticipant) => {
              if (track.kind !== Track.Kind.Audio) return;
              const el = track.attach();
              el.autoplay = true;
              el.setAttribute('playsinline', '');
              audioContainer.current?.appendChild(el);
              // The worker publishes nothing, so any audio here is a leg someone
              // else put on air — which is what a monitor is here to hear.
              if (participant.isAgent || !track.mediaStreamTrack) return;
              const leg: RemoteLeg = {
                key: pub.trackSid,
                label: legLabel(pub, participant),
                role: roleFromTrackName(pub.trackName),
                track: track.mediaStreamTrack,
              };
              setRemoteLegs((prev) => [...prev.filter((l) => l.key !== leg.key), leg]);
              refresh();
            }
          )
          .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, pub: RemoteTrackPublication) => {
            track.detach().forEach((el) => el.remove());
            setRemoteLegs((prev) => prev.filter((l) => l.key !== pub.trackSid));
            refresh();
          })
          .on(RoomEvent.DataReceived, (payload: Uint8Array, _p, _kind, topic?: string) => {
            if (topic !== TRANSCRIPT_TOPIC && topic !== SUGGESTION_TOPIC) return;
            let parsed: unknown;
            try {
              parsed = JSON.parse(new TextDecoder().decode(payload));
            } catch {
              return;
            }
            if (!parsed || typeof parsed !== 'object') return;
            if (topic === TRANSCRIPT_TOPIC) applyTranscript(parsed as Record<string, unknown>);
            else applySuggestion(parsed as Record<string, unknown>);
          })
          .on(RoomEvent.Disconnected, () => {
            if (roomRef.current !== room) return; // our own leave()
            roomRef.current = null;
            captureRef.current?.getTracks().forEach((t) => t.stop());
            captureRef.current = null;
            setPhase('idle');
            setError('Disconnected from the call.');
          });

        await room.connect(data.serverUrl, data.token);
        setMe({ identity: data.identity, name, customer });
        setPhase('joined');

        // Still inside the click that started this, so the browser lets us start
        // playback without a second gesture. Nothing is published yet — going on
        // air is a separate, deliberate action.
        await room.startAudio().catch(() => undefined);
        refresh();
      } catch (e) {
        const room = roomRef.current;
        roomRef.current = null;
        if (room) void room.disconnect();
        setPhase('idle');
        setError(e instanceof Error ? e.message : 'Could not join the call');
      }
    },
    [addLine, applySuggestion, applyTranscript, audioContainer]
  );

  // -- the agent's leg -----------------------------------------------------

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    setMicError(null);

    try {
      const existing = micRef.current;
      if (existing) {
        if (existing.isMuted) {
          await existing.unmute();
          setMicEnabled(true);
        } else {
          // Muted, not unpublished: the publication stays, so the worker's leg
          // keeps its binding and picks straight back up. Unpublishing would make
          // it rebind, and rebinding costs the filter's warm state.
          await existing.mute();
          setMicEnabled(false);
        }
        return;
      }

      // Published by hand rather than through `setMicrophoneEnabled`, which gives
      // no way to name the track — and the name is what the worker resolves the
      // leg from before it falls back to the source.
      const track = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
      await room.localParticipant.publishTrack(track, {
        name: AGENT_TRACK,
        source: Track.Source.Microphone,
        audioPreset: AudioPresets.speech,
        forceStereo: false,
      });
      micRef.current = track;
      setMicEnabled(true);
      setMicTrack(track.mediaStreamTrack);
    } catch (e) {
      setMicEnabled(false);
      setMicError(
        e instanceof Error ? `Microphone unavailable: ${e.message}` : 'Microphone unavailable.'
      );
    }
  }, []);

  // -- the customer's leg --------------------------------------------------

  const stopCustomerAudio = useCallback(async () => {
    const room = roomRef.current;
    const track = customerRef.current;
    if (room && track) {
      try {
        // `false`: releaseCapture below stops every track of the capture, which
        // is what actually ends the browser's share indicator.
        await room.localParticipant.unpublishTrack(track, false);
      } catch {
        // Already gone (the room dropped, or the share ended under us). Releasing
        // the capture below is the part that matters.
      }
    }
    releaseCapture();
  }, [releaseCapture]);

  const shareCustomerAudio = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    setCustomerError(null);

    let capture: MediaStream;
    try {
      // Video is requested because Chrome refuses an audio-only display capture,
      // not because anything wants it — it is never published. Every processing
      // option is off: this leg is a re-capture of a phone line, the worker's own
      // filter is what cleans it up, and browser AGC on a tab capture pumps
      // audibly between a talking caller and a silent one.
      capture = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (e) {
      setCustomerError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Screen share was cancelled, so the customer side is not being captured.'
          : e instanceof Error
            ? `Could not capture the customer audio: ${e.message}`
            : 'Could not capture the customer audio.'
      );
      return;
    }

    const [audio] = capture.getAudioTracks();
    if (!audio) {
      // By far the most common mistake, and it looks like a broken app rather than
      // a missed checkbox: the share succeeds, video arrives, and the customer is
      // simply never transcribed.
      capture.getTracks().forEach((t) => t.stop());
      setCustomerError(
        'That share carried no audio. Pick a browser tab and tick "Also share tab audio" ' +
          '(on Windows, "Share system audio" works for a desktop softphone; on macOS Chrome ' +
          'can only capture a tab).'
      );
      return;
    }

    captureRef.current = capture;

    // The browser's own "Stop sharing" button ends these tracks without telling
    // the app anything else. Without this the publication stays up, delivering
    // silence, and the room still reads as being on air.
    const onEnded = () => {
      void stopCustomerAudio();
    };
    capture.getTracks().forEach((t) => t.addEventListener('ended', onEnded, { once: true }));

    try {
      await room.localParticipant.publishTrack(audio, {
        name: CUSTOMER_TRACK,
        source: Track.Source.ScreenShareAudio,
        // `speech`, not the default `music`: a phone leg carries nothing above
        // 4 kHz, and the music preset spends four times the bitrate on it. Mono
        // for the same reason, and because stereo would disable DTX and RED.
        audioPreset: AudioPresets.speech,
        forceStereo: false,
      });
      customerRef.current = audio;
      setCustomerLive(true);
      setCustomerTrack(audio);
    } catch (e) {
      capture.getTracks().forEach((t) => t.stop());
      captureRef.current = null;
      setCustomerError(
        e instanceof Error
          ? `Could not publish the customer audio: ${e.message}`
          : 'Could not publish the customer audio.'
      );
    }
  }, [stopCustomerAudio]);

  // -- typed turns ---------------------------------------------------------

  const sendMessage = useCallback(
    async (text: string, role: Role) => {
      const room = roomRef.current;
      const trimmed = text.trim();
      if (!room || !trimmed) return;

      const info = await room.localParticipant.sendText(trimmed, {
        topic: CHAT_TOPIC,
        attributes: { [CHAT_ROLE_ATTRIBUTE]: role },
      });
      // sendText does not loop back to the sender, so our own line has to be
      // added here. Keyed on the stream id — the same id every other client sees
      // — so it cannot end up on screen twice.
      addLine({
        id: info.id,
        role,
        name:
          role === 'customer'
            ? me?.customer || ROLE_LABEL.customer
            : me?.name || ROLE_LABEL.agent,
        text: trimmed,
        final: true,
        ts: Date.now(),
        via: 'text',
      });
    },
    [addLine, me]
  );

  const retryWorker = useCallback(async () => {
    setWorkerError(null);
    try {
      const res = await fetch('/api/dispatch-worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room: roomNameRef.current }),
      });
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        setWorkerError(data.error || 'Could not dispatch the assist worker.');
      }
    } catch {
      setWorkerError('Could not reach the server to dispatch the worker.');
    }
  }, []);

  const onAir = micEnabled && customerLive;

  // One automatic retry once a leg is on air and the worker still is not here.
  // The common cause is the worker having been mid-startup when the room was
  // created, and by now it is registered — so asking again just works. Guarded by
  // a ref so it happens once per call, not once per render.
  const retriedRef = useRef(false);
  useEffect(() => {
    const publishing = micEnabled || customerLive;
    if (!publishing || workerPresent || retriedRef.current) return;
    const timer = setTimeout(() => {
      retriedRef.current = true;
      void retryWorker();
    }, 4000);
    return () => clearTimeout(timer);
  }, [micEnabled, customerLive, workerPresent, retryWorker]);

  useEffect(() => {
    if (phase === 'idle') retriedRef.current = false;
  }, [phase]);

  return useMemo(
    () => ({
      phase,
      error,
      connecting: phase === 'connecting',
      me,
      publishers,
      workerPresent,
      workerError,
      transcript,
      suggestions,
      micEnabled,
      micError,
      micTrack,
      customerLive,
      customerError,
      customerTrack,
      onAir,
      remoteLegs,
      join,
      leave,
      toggleMic,
      shareCustomerAudio,
      stopCustomerAudio,
      sendMessage,
      retryWorker,
    }),
    [
      phase,
      error,
      me,
      publishers,
      workerPresent,
      workerError,
      transcript,
      suggestions,
      micEnabled,
      micError,
      micTrack,
      customerLive,
      customerError,
      customerTrack,
      onAir,
      remoteLegs,
      join,
      leave,
      toggleMic,
      shareCustomerAudio,
      stopCustomerAudio,
      sendMessage,
      retryWorker,
    ]
  );
}
