"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Records console session audio in the browser and uploads it when the session
 * ends. Two files are produced per session:
 *
 *  - `agent` — only what the agent generated (its TTS output)
 *  - `mixed` — the agent plus your microphone, i.e. the whole conversation
 *
 * Both are built with Web Audio destinations so tracks can be attached as they
 * appear (the agent joins a moment after the room connects).
 */

export type RecordingKind = "mixed" | "agent";

export interface SavedRecording {
  file: string;
  agent: string;
  room: string;
  kind: RecordingKind;
  mimeType: string;
  bytes: number;
  durationMs: number;
  /** Wall clock of the first recorded sample — the Console's audio↔event clock. */
  startedAt: string;
  createdAt: string;
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

interface Session {
  room: string;
  startedAt: number;
  ctx: AudioContext;
  destinations: Record<RecordingKind, MediaStreamAudioDestinationNode>;
  recorders: { kind: RecordingKind; recorder: MediaRecorder; chunks: Blob[] }[];
  /** MediaStreamTrack ids already wired into the graph. */
  wired: Set<string>;
  sources: MediaStreamAudioSourceNode[];
}

export function useSessionRecorder({
  agentName,
  roomName,
  live,
  agentTrack,
  micTrack,
  onSaved,
  onError,
}: {
  agentName: string;
  roomName: string | null;
  live: boolean;
  agentTrack?: MediaStreamTrack;
  micTrack?: MediaStreamTrack;
  onSaved: (recording: SavedRecording) => void;
  onError?: (message: string) => void;
}) {
  const sessionRef = useRef<Session | null>(null);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [unsupported, setUnsupported] = useState(false);

  // Callbacks are captured in the stop path, which runs during cleanup — keep
  // them in refs so the recording effect never restarts because of a new
  // closure identity.
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const stopAndUpload = useCallback(async (session: Session) => {
    const durationMs = Date.now() - session.startedAt;

    const blobs = await Promise.all(
      session.recorders.map(
        ({ kind, recorder, chunks }) =>
          new Promise<{ kind: RecordingKind; blob: Blob }>((resolve) => {
            const finish = () =>
              resolve({
                kind,
                blob: new Blob(chunks, { type: recorder.mimeType || "audio/webm" }),
              });
            if (recorder.state === "inactive") {
              finish();
              return;
            }
            recorder.onstop = finish;
            try {
              recorder.stop();
            } catch {
              finish();
            }
          })
      )
    );

    for (const source of session.sources) {
      try {
        source.disconnect();
      } catch {}
    }
    try {
      await session.ctx.close();
    } catch {}

    // A session that produced nothing (agent never joined, mic denied) would
    // only add empty files.
    const worthKeeping = blobs.filter((b) => b.blob.size > 2048);
    if (worthKeeping.length === 0 || durationMs < 1000) return;

    setUploading(true);
    try {
      for (const { kind, blob } of worthKeeping) {
        const form = new FormData();
        form.append("audio", blob, `${session.room}-${kind}.webm`);
        form.append("room", session.room);
        form.append("kind", kind);
        form.append("durationMs", String(durationMs));
        form.append("startedAt", String(session.startedAt));

        const res = await fetch(
          `/api/agents/${encodeURIComponent(agentName)}/recordings`,
          { method: "POST", body: form }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          onErrorRef.current?.(data.error || `Failed to save ${kind} recording`);
          continue;
        }
        if (data.recording) onSavedRef.current(data.recording as SavedRecording);
      }
    } catch (err) {
      onErrorRef.current?.(err instanceof Error ? err.message : String(err));
    } finally {
      setUploading(false);
    }
  }, [agentName]);

  // ── Start / stop with the session ──
  useEffect(() => {
    if (!live || !roomName) return;

    const mimeType = pickMimeType();
    const AudioCtor =
      typeof window === "undefined"
        ? undefined
        : window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!mimeType || !AudioCtor) {
      setUnsupported(true);
      return;
    }

    const ctx = new AudioCtor();
    const session: Session = {
      room: roomName,
      startedAt: Date.now(),
      ctx,
      destinations: {
        mixed: ctx.createMediaStreamDestination(),
        agent: ctx.createMediaStreamDestination(),
      },
      recorders: [],
      wired: new Set(),
      sources: [],
    };

    for (const kind of ["mixed", "agent"] as RecordingKind[]) {
      const recorder = new MediaRecorder(session.destinations[kind].stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.start(1000);
      session.recorders.push({ kind, recorder, chunks });
    }

    void ctx.resume().catch(() => {});
    sessionRef.current = session;
    setRecording(true);

    return () => {
      sessionRef.current = null;
      setRecording(false);
      void stopAndUpload(session);
    };
  }, [live, roomName, stopAndUpload]);

  // ── Attach tracks as they show up ──
  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;

    const attach = (track: MediaStreamTrack | undefined, kinds: RecordingKind[]) => {
      if (!track || session.wired.has(track.id)) return;
      try {
        const source = session.ctx.createMediaStreamSource(new MediaStream([track]));
        for (const kind of kinds) source.connect(session.destinations[kind]);
        session.sources.push(source);
        session.wired.add(track.id);
      } catch (err) {
        onErrorRef.current?.(
          `Could not capture ${kinds.join("/")} audio: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    };

    attach(agentTrack, ["mixed", "agent"]);
    attach(micTrack, ["mixed"]);
  }, [agentTrack, micTrack, recording]);

  return { recording, uploading, unsupported };
}
