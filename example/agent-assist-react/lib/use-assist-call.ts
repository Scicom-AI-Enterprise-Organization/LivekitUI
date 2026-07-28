'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ConnectionState,
  RemoteParticipant,
  Room,
  RoomEvent,
  Track,
  type LocalParticipant,
  type Participant,
  type RemoteTrack,
} from 'livekit-client';
import {
  CHAT_TOPIC,
  isRole,
  NAME_ATTRIBUTE,
  otherRole,
  ROLE_ATTRIBUTE,
  SUGGESTION_TOPIC,
  TRANSCRIPT_TOPIC,
  type Role,
  type Seat,
  type Suggestion,
  type TranscriptLine,
} from './types';

/**
 * `idle` — the join form. `waiting` — connected, holding for the other side.
 * `live` — both humans present. The phase is derived from who is in the room,
 * never set by hand, so someone dropping out puts the call back in `waiting`.
 */
export type Phase = 'idle' | 'connecting' | 'waiting' | 'live';

/** Enough scrollback to follow a call without growing without bound. */
const MAX_TRANSCRIPT_LINES = 400;
const MAX_SUGGESTIONS = 8;

interface JoinArgs {
  name: string;
  role: Role;
  room: string;
}

export interface AssistCall {
  phase: Phase;
  error: string | null;
  connecting: boolean;
  me: Seat | null;
  seats: Seat[];
  workerPresent: boolean;
  /** Why the worker is not here, when the server could say. */
  workerError: string | null;
  transcript: TranscriptLine[];
  suggestions: Suggestion[];
  micEnabled: boolean;
  /** Why the microphone is not publishing, when the browser said. */
  micError: string | null;
  /** Your own microphone, for the level meter. */
  micTrack: MediaStreamTrack | null;
  /** The other person's audio, for their level meter. */
  remoteTrack: MediaStreamTrack | null;
  join: (args: JoinArgs) => Promise<void>;
  leave: () => void;
  toggleMic: () => void;
  sendMessage: (text: string) => Promise<void>;
  /** Ask the server to dispatch the worker into a room that already exists. */
  retryWorker: () => Promise<void>;
}

/** The raw MediaStreamTrack behind the local microphone, for the level meter. */
function micStreamTrack(room: Room): MediaStreamTrack | null {
  const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
  return pub?.track?.mediaStreamTrack ?? null;
}

function seatOf(p: Participant): Seat | null {
  const role = p.attributes?.[ROLE_ATTRIBUTE];
  if (!isRole(role)) return null;
  return { role, name: p.attributes?.[NAME_ATTRIBUTE] || p.name || p.identity, identity: p.identity };
}

/**
 * @param audioContainer where subscribed audio elements are appended. It is the
 * caller's ref, not one handed back in the return value: returning a ref would
 * make every read of this hook's result a ref access during render.
 */
export function useAssistCall(
  audioContainer: React.RefObject<HTMLDivElement | null>
): AssistCall {
  const roomRef = useRef<Room | null>(null);

  const roomNameRef = useRef<string>('');
  const meRef = useRef<Seat | null>(null);

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<Seat | null>(null);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [workerPresent, setWorkerPresent] = useState(false);
  const [workerError, setWorkerError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [micTrack, setMicTrack] = useState<MediaStreamTrack | null>(null);
  const [remoteTrack, setRemoteTrack] = useState<MediaStreamTrack | null>(null);

  const leave = useCallback(() => {
    const room = roomRef.current;
    roomRef.current = null;
    if (room) void room.disconnect();
    meRef.current = null;
    setPhase('idle');
    setSeats([]);
    setMe(null);
    setWorkerPresent(false);
    setWorkerError(null);
    setTranscript([]);
    setSuggestions([]);
    setMicEnabled(false);
    setMicError(null);
    setMicTrack(null);
    setRemoteTrack(null);
  }, []);

  // Leaving the page mid-call has to drop the participant, or the room stays
  // occupied and the next person is told the seat is taken.
  useEffect(() => {
    return () => {
      const room = roomRef.current;
      roomRef.current = null;
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
      if (payload.event === 'joined') return; // the room's own events cover this

      // The worker reporting that its STT (or LLM) is failing. Without this the
      // whole call looks like a microphone problem: the worker is in the room, the
      // level meter moves, and the transcript stays empty forever.
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
        name: typeof payload.name === 'string' ? payload.name : role,
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
    async ({ name, role, room: roomName }: JoinArgs) => {
      if (roomRef.current) return;
      setError(null);
      setPhase('connecting');

      try {
        const res = await fetch('/api/connection-details', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, role, room: roomName }),
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
        // echoed it back.
        room.registerTextStreamHandler(CHAT_TOPIC, (reader, participantInfo) => {
          void reader.readAll().then((text) => {
            if (!text.trim()) return;
            const sender = room.getParticipantByIdentity(participantInfo.identity);
            const seat = sender ? seatOf(sender) : null;
            if (!seat) return;
            addLine({
              id: reader.info.id,
              role: seat.role,
              name: seat.name,
              text,
              final: true,
              ts: Date.now(),
              via: 'text',
            });
          });
        });

        const refreshSeats = () => {
          const found: Seat[] = [];
          let worker = false;
          const local = room.localParticipant as LocalParticipant | undefined;
          if (local) {
            const seat = seatOf(local);
            if (seat) found.push(seat);
          }
          room.remoteParticipants.forEach((p: RemoteParticipant) => {
            // The assist worker joins as a kind=agent participant with no role.
            if (p.isAgent) {
              worker = true;
              return;
            }
            const seat = seatOf(p);
            if (seat) found.push(seat);
          });
          setSeats(found);
          setWorkerPresent(worker);
          setPhase(found.some((s) => s.role === otherRole(role)) ? 'live' : 'waiting');
        };

        room
          .on(RoomEvent.ParticipantConnected, refreshSeats)
          .on(RoomEvent.ParticipantDisconnected, refreshSeats)
          .on(RoomEvent.ParticipantAttributesChanged, refreshSeats)
          .on(RoomEvent.TrackSubscribed, (track: RemoteTrack, _pub, participant) => {
            if (track.kind !== Track.Kind.Audio) return;
            const el = track.attach();
            el.autoplay = true;
            el.setAttribute('playsinline', '');
            audioContainer.current?.appendChild(el);
            // The worker publishes nothing, so any audio here is the other human.
            if (!participant.isAgent) setRemoteTrack(track.mediaStreamTrack);
          })
          .on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
            track.detach().forEach((el) => el.remove());
            setRemoteTrack((current) => (current === track.mediaStreamTrack ? null : current));
          })
          .on(RoomEvent.LocalTrackPublished, () => {
            setMicEnabled(room.localParticipant.isMicrophoneEnabled);
            setMicTrack(micStreamTrack(room));
          })
          .on(RoomEvent.LocalTrackUnpublished, () => {
            setMicEnabled(room.localParticipant.isMicrophoneEnabled);
            setMicTrack(micStreamTrack(room));
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
            setPhase('idle');
            setError('Disconnected from the call.');
          });

        await room.connect(data.serverUrl, data.token);
        meRef.current = { role, name, identity: data.identity };
        setMe(meRef.current);

        // Still inside the click that started this, so the browser lets us both
        // start playback and open the microphone without a second prompt.
        await room.startAudio().catch(() => undefined);

        // A refused or missing microphone must not fail the join: typing still
        // works, and the alternative is an error screen for a call that would
        // otherwise be usable. It does have to be *said*, though — a silent
        // failure here is indistinguishable from broken transcription.
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          setMicEnabled(room.localParticipant.isMicrophoneEnabled);
          setMicTrack(micStreamTrack(room));
        } catch (micFailure) {
          setMicEnabled(false);
          setMicError(
            micFailure instanceof Error
              ? `Microphone unavailable: ${micFailure.message}`
              : 'Microphone unavailable.'
          );
        }

        refreshSeats();
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

  const sendMessage = useCallback(
    async (text: string) => {
      const room = roomRef.current;
      const trimmed = text.trim();
      const seat = meRef.current;
      if (!room || !trimmed || !seat) return;

      const info = await room.localParticipant.sendText(trimmed, { topic: CHAT_TOPIC });
      // sendText does not loop back to the sender, so the sender's own line has to
      // be added here. Keyed on the stream id — the same id every other client
      // sees — so it cannot end up on screen twice.
      addLine({
        id: info.id,
        role: seat.role,
        name: seat.name,
        text: trimmed,
        final: true,
        ts: Date.now(),
        via: 'text',
      });
    },
    [addLine]
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

  const toggleMic = useCallback(() => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected) return;
    const next = !room.localParticipant.isMicrophoneEnabled;
    void room.localParticipant
      .setMicrophoneEnabled(next)
      .then(() => {
        setMicEnabled(next);
        setMicError(null);
        setMicTrack(micStreamTrack(room));
      })
      .catch((e: unknown) => {
        setMicError(e instanceof Error ? `Microphone unavailable: ${e.message}` : 'Microphone unavailable.');
      });
  }, []);

  // One automatic retry once both people are in and the worker still is not.
  // The common cause is the worker having been mid-startup when the room was
  // created, and by now it is registered — so asking again just works. Guarded by
  // a ref so it happens once per call, not once per render.
  const retriedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'live' || workerPresent || retriedRef.current) return;
    const timer = setTimeout(() => {
      retriedRef.current = true;
      void retryWorker();
    }, 4000);
    return () => clearTimeout(timer);
  }, [phase, workerPresent, retryWorker]);

  useEffect(() => {
    if (phase === 'idle') retriedRef.current = false;
  }, [phase]);

  return useMemo(
    () => ({
      phase,
      error,
      connecting: phase === 'connecting',
      me,
      seats,
      workerPresent,
      workerError,
      transcript,
      suggestions,
      micEnabled,
      micError,
      micTrack,
      remoteTrack,
      join,
      leave,
      toggleMic,
      sendMessage,
      retryWorker,
    }),
    [
      phase,
      error,
      me,
      seats,
      workerPresent,
      workerError,
      transcript,
      suggestions,
      micEnabled,
      micError,
      micTrack,
      remoteTrack,
      join,
      leave,
      toggleMic,
      sendMessage,
      retryWorker,
    ]
  );
}
