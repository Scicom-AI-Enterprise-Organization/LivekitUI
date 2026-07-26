"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ConsoleMetric } from "@/lib/console-metrics";
import type { AgentConfigView, ConsoleEvent, TranscriptLine } from "./session-types";

/**
 * Writes a console session to the history when it ends.
 *
 * Everything the console shows lives in the browser, so a reload used to be the
 * end of it. This posts the events, metrics and transcript to `/api/sessions`
 * so `/sessions/history/<id>` can replay them next to the audio, which uploads
 * separately and is joined back by room name.
 *
 * The save is keyed on the room and upserts, so saving twice — once when the
 * session ends, once if the page is left immediately after — is harmless.
 */

/** Let trailing events (room.disconnected, the last metric) land before saving. */
const SETTLE_MS = 1200;

export interface SavedSessionRef {
  id: number;
  room: string;
}

export function useSessionPersistence({
  agentName,
  roomName,
  live,
  startedAt,
  endedAt,
  talkMode,
  roomSid,
  agentIdentity,
  participants,
  serverUrl,
  config,
  events,
  metrics,
  transcript,
  onSaved,
  onError,
}: {
  agentName: string;
  roomName: string | null;
  live: boolean;
  startedAt: number | null;
  endedAt: number | null;
  talkMode: string;
  roomSid: string | null;
  agentIdentity?: string;
  participants: number;
  serverUrl: string;
  config: AgentConfigView | null;
  events: ConsoleEvent[];
  metrics: ConsoleMetric[];
  transcript: TranscriptLine[];
  onSaved?: (session: SavedSessionRef) => void;
  onError?: (message: string) => void;
}) {
  // The save runs from an effect cleanup or a timer, both of which see stale
  // closures — so the payload is read from a ref refreshed after every render.
  const snapshotRef = useRef({
    agentName,
    roomName,
    startedAt,
    endedAt,
    talkMode,
    roomSid,
    agentIdentity,
    participants,
    serverUrl,
    config,
    events,
    metrics,
    transcript,
  });
  const onSavedRef = useRef(onSaved);
  const onErrorRef = useRef(onError);

  // No dependency list: every commit refreshes the snapshot, and it must be
  // current before the settle timer or an unmount reads it.
  useEffect(() => {
    snapshotRef.current = {
      agentName,
      roomName,
      startedAt,
      endedAt,
      talkMode,
      roomSid,
      agentIdentity,
      participants,
      serverUrl,
      config,
      events,
      metrics,
      transcript,
    };
    onSavedRef.current = onSaved;
    onErrorRef.current = onError;
  });

  /** The room whose session has not been written yet. */
  const pendingRef = useRef<string | null>(null);

  const save = useCallback(async (leaving: boolean) => {
    const snapshot = snapshotRef.current;
    const room = pendingRef.current;
    if (!room || !snapshot.startedAt) return;

    // A session with nothing in it is noise in the history list.
    if (snapshot.events.length === 0 && snapshot.transcript.length === 0) {
      pendingRef.current = null;
      return;
    }

    pendingRef.current = null;

    const body = JSON.stringify({
      agentName: snapshot.agentName,
      room,
      roomSid: snapshot.roomSid,
      talkMode: snapshot.talkMode,
      startedAt: snapshot.startedAt,
      endedAt: snapshot.endedAt ?? Date.now(),
      durationMs: (snapshot.endedAt ?? Date.now()) - snapshot.startedAt,
      participants: snapshot.participants,
      agentIdentity: snapshot.agentIdentity ?? null,
      serverUrl: snapshot.serverUrl,
      config: snapshot.config ?? {},
      events: snapshot.events,
      metrics: snapshot.metrics,
      transcript: snapshot.transcript,
    });

    // Leaving the page: `keepalive` survives the navigation, but only for small
    // bodies. A long session is better saved than truncated, so an oversized
    // payload still goes out as a normal request and takes its chances.
    const keepalive = leaving && body.length < 60_000;

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        onErrorRef.current?.(data.error || `Could not save the session (HTTP ${res.status})`);
        return;
      }
      if (data.session) onSavedRef.current?.({ id: data.session.id, room });
    } catch {
      // Navigating away aborts the request; nothing useful to report then.
      if (!leaving) onErrorRef.current?.("Could not reach the dashboard API to save the session");
    }
  }, []);

  // A live room is a session owing a save; losing `live` settles and writes it.
  useEffect(() => {
    if (live && roomName) {
      pendingRef.current = roomName;
      return;
    }
    if (!pendingRef.current) return;

    const timer = setTimeout(() => void save(false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [live, roomName, save]);

  // Unmounting with a save still owed — the tab navigated away mid-call, or the
  // settle timer never got to fire.
  useEffect(() => {
    return () => {
      if (pendingRef.current) void save(true);
    };
  }, [save]);
}
