#!/usr/bin/env node
/**
 * Records one LiveKit room to disk, so a session lands in the dashboard's
 * history whether or not anyone had a browser tab open.
 *
 * The console page has always done this job for sessions it hosts — it is a
 * participant, so it sees the transcript, the events and the audio. A phone call
 * that reaches an agent through SIP, or a sandbox app talking to it directly,
 * had nobody to write any of that down. This process is that somebody: the
 * supervisor (`src/lib/session-observer.ts`) starts one per room off the
 * `room_started` webhook, it joins as a hidden participant, and it writes what it
 * heard next to a WAV when the room closes.
 *
 * It holds no dashboard credentials on purpose. Instead it drops a
 * `<room>.json` / `<room>.wav` pair into `data/session-captures`, and
 * `src/lib/session-capture.ts` adopts the pair into the database and object
 * storage — the same way the recordings index already adopts sidecar files. The
 * JSON is written last and via a rename, so a half-written capture is never
 * visible to the adopter.
 *
 * Deliberately not here: parsing metrics. The raw agent payloads are stored as
 * they arrived and `parseConsoleMetric` runs during adoption, so the observer
 * cannot drift from the parser the console and the replay share.
 */

import fs from "node:fs";
import path from "node:path";
import {
  AudioStream,
  ConnectionState,
  DisconnectReason,
  ParticipantKind,
  Room,
  RoomEvent,
  TrackKind,
  TrackSource,
} from "@livekit/rtc-node";
import { createMixer, createWavWriter, SAMPLE_RATE } from "./wav-mixer.mjs";

/* ── Configuration ──────────────────────────────────────────────────────── */

const cfg = {
  url: env("OBSERVER_URL"),
  token: env("OBSERVER_TOKEN"),
  room: env("OBSERVER_ROOM"),
  outDir: env("OBSERVER_OUT_DIR"),
  captureId: env("OBSERVER_CAPTURE_ID"),
  serverUrl: process.env.OBSERVER_SERVER_URL || "",
  roomSid: process.env.OBSERVER_ROOM_SID || null,
  agentHint: process.env.OBSERVER_AGENT || "",
  metricsTopic: process.env.OBSERVER_METRICS_TOPIC || "lk.metrics",
  transcriptionTopic: process.env.OBSERVER_TRANSCRIPTION_TOPIC || "lk.transcription",
  /**
   * Typed messages travel on their own topic and never become transcriptions —
   * an agent reached by text would otherwise be recorded talking to itself.
   */
  chatTopic: process.env.OBSERVER_CHAT_TOPIC || "lk.chat",
  segmentAttribute: process.env.OBSERVER_SEGMENT_ATTRIBUTE || "lk.segment_id",
  agentStateAttribute: process.env.OBSERVER_AGENT_STATE_ATTRIBUTE || "lk.agent.state",
  consolePrefix: process.env.OBSERVER_CONSOLE_PREFIX || "console-",
  consoleAttribute: process.env.OBSERVER_CONSOLE_ATTRIBUTE || "dashboard.console",
  /** The supervisor's PID file for this room; cleared on the way out. */
  recordFile: process.env.OBSERVER_RECORD_FILE || "",
  audio: process.env.OBSERVER_AUDIO !== "off",
  startedAt: Number(process.env.OBSERVER_ROOM_STARTED_AT) || Date.now(),
  maxMs: (Number(process.env.OBSERVER_MAX_MINUTES) || 60) * 60_000,
  /** How long an empty room is given to refill before giving up on it. */
  idleExitMs: Number(process.env.OBSERVER_IDLE_EXIT_MS) || 30_000,
  /** Sessions shorter than this are noise — a connect that went nowhere. */
  minAudioMs: 500,
};

function env(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`[observer] ${name} is required`);
    process.exit(2);
  }
  return value;
}

const log = (message) => console.log(`[observer ${cfg.room}] ${message}`);

/* ── Collected session ──────────────────────────────────────────────────── */

const events = [];
/** Keyed on segment id: a segment's text grows, its timestamp must not. */
const segments = new Map();
const metricsRaw = [];

let seq = 0;
let roomSid = cfg.roomSid;
let agentIdentity = null;
let agentName = cfg.agentHint || agentFromRoomName(cfg.room);
let talkMode = "browser";
let peakParticipants = 0;
let consoleSeen = false;
let cappedReported = false;

function addEvent(name, detail, level = "info") {
  seq += 1;
  events.push({ id: `obs-${seq}`, at: Date.now(), name, detail: String(detail ?? ""), level });
}

/**
 * `agent-console-<name>-<ts>` and `agent-preview-<name>-<ts>` are the dashboard's
 * own room names, so the agent is readable straight off them. Anything else —
 * a SIP room, a sandbox room — relies on the supervisor's dispatch lookup or on
 * the agent participant that joins later.
 */
function agentFromRoomName(room) {
  const match = /^agent-(?:console|preview)-(.+)-\d{10,}$/.exec(room);
  return match ? match[1] : "";
}

/* ── Audio ──────────────────────────────────────────────────────────────── */

const wavPath = path.join(cfg.outDir, `${cfg.captureId}.wav`);
const wavPartPath = `${wavPath}.part`;

/** Wall clock of the first mixed sample — the audio ↔ event clock. */
const audioStartedAt = Date.now();
let wav = null;
let mixer = null;
let audioStopped = false;

function startAudio() {
  if (!cfg.audio) return;
  fs.mkdirSync(cfg.outDir, { recursive: true });
  wav = createWavWriter(wavPartPath);
  mixer = createMixer({ write: (chunk) => wav.write(chunk), maxDurationMs: cfg.maxMs });
}

/** Discards the recording, for when the console is doing it instead. */
function dropAudio(reason) {
  if (!mixer && !wav) return;
  audioStopped = true;
  mixer = null;
  try {
    wav?.close();
  } catch {}
  wav = null;
  try {
    fs.unlinkSync(wavPartPath);
  } catch {}
  addEvent("recording.skipped", reason, "warn");
  log(`audio dropped — ${reason}`);
}

async function pumpAudio(track, publication, participant) {
  // Video is subscribed too — a sandbox may publish a camera — but only audio
  // belongs in the mix, and AudioStream would reject the rest.
  if (!mixer || publication?.kind === TrackKind.KIND_VIDEO) return;
  const trackId = publication?.sid || `${participant.identity}:${track.sid ?? "audio"}`;
  const stream = new AudioStream(track, { sampleRate: SAMPLE_RATE, numChannels: 1 });

  try {
    for await (const frame of stream) {
      if (audioStopped || !mixer) break;
      // Only the first frame of a track uses this; after that the mixer follows
      // the track's own sample count, so its audio cannot drift internally.
      const offset = Math.round(((Date.now() - audioStartedAt) / 1000) * SAMPLE_RATE);
      mixer.add(trackId, frame.data, offset);
      if (mixer.capped && !cappedReported) {
        cappedReported = true;
        addEvent("recording.capped", `stopped at ${cfg.maxMs / 60_000} minutes`, "warn");
      }
    }
  } catch (err) {
    if (!audioStopped) addEvent("recording.error", messageOf(err), "warn");
  }
}

/* ── Room ───────────────────────────────────────────────────────────────── */

const room = new Room();

const KIND_LABEL = {
  [ParticipantKind.STANDARD]: "standard",
  [ParticipantKind.INGRESS]: "ingress",
  [ParticipantKind.EGRESS]: "egress",
  [ParticipantKind.SIP]: "sip",
  [ParticipantKind.AGENT]: "agent",
};

const SOURCE_LABEL = {
  [TrackSource.SOURCE_CAMERA]: "camera",
  [TrackSource.SOURCE_MICROPHONE]: "microphone",
  [TrackSource.SOURCE_SCREENSHARE]: "screenshare",
  [TrackSource.SOURCE_SCREENSHARE_AUDIO]: "screenshare audio",
};

/** The enums are numeric over the wire, and "2" means nothing in a log line. */
function trackLabel(publication) {
  const source = SOURCE_LABEL[publication?.source ?? -1];
  return source || publication?.name || publication?.sid || "track";
}

/** Turns an enum member back into its name, since the event log is read by people. */
function enumLabel(enumObject, value) {
  const name = enumObject[value];
  return typeof name === "string" ? name.toLowerCase() : String(value);
}

function noteParticipant(participant) {
  const kind = KIND_LABEL[participant.kind] ?? "standard";

  if (participant.kind === ParticipantKind.AGENT) {
    agentIdentity = participant.identity;
    // Agent identities are job-scoped (`agent-<id>`), so they are a last resort
    // for the name — the dispatch lookup and the room name are both better.
    if (!agentName) agentName = participant.name || participant.identity;
  }
  // A phone leg anywhere in the call makes this a telephony session.
  if (participant.kind === ParticipantKind.SIP) talkMode = "sip";

  // The console records itself, audio included. Two "mixed" recordings for one
  // room would collide on the same storage key, so the tab wins and this
  // process keeps only the transcript and the log. The attribute is stamped on
  // console tokens; the identity prefix is the older signal and still holds for
  // a tab attached to a phone call.
  if (
    participant.attributes?.[cfg.consoleAttribute] === "1" ||
    participant.identity.startsWith(cfg.consolePrefix)
  ) {
    consoleSeen = true;
    dropAudio("the console tab is recording this session");
  }

  return kind;
}

/**
 * The state an agent is already in when the observer arrives.
 *
 * `participantAttributesChanged` only fires on a *change*, and the observer
 * starts a beat after the room does — the agent is often already listening by
 * then. Without this the timeline's first state span would begin at whatever the
 * agent happened to do next.
 */
function noteInitialAgentState(participant) {
  const state = participant.attributes?.[cfg.agentStateAttribute];
  if (state) addEvent("agent.state", state);
}

room
  .on(RoomEvent.ParticipantConnected, (participant) => {
    const kind = noteParticipant(participant);
    peakParticipants = Math.max(peakParticipants, room.remoteParticipants.size);
    addEvent("participant.joined", `${participant.identity} (${kind})`);
    noteInitialAgentState(participant);
  })
  .on(RoomEvent.ParticipantDisconnected, (participant) => {
    addEvent("participant.left", participant.identity);
  })
  .on(RoomEvent.TrackPublished, (publication, participant) => {
    addEvent("track.published", `${participant.identity} · ${trackLabel(publication)}`);
  })
  .on(RoomEvent.TrackUnpublished, (publication, participant) => {
    addEvent("track.unpublished", `${participant.identity} · ${trackLabel(publication)}`);
  })
  .on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    addEvent("track.subscribed", `${participant.identity} · ${trackLabel(publication)}`);
    void pumpAudio(track, publication, participant);
  })
  .on(RoomEvent.TrackMuted, (publication, participant) => {
    addEvent("track.muted", `${participant.identity} · ${trackLabel(publication)}`);
  })
  .on(RoomEvent.TrackUnmuted, (publication, participant) => {
    addEvent("track.unmuted", `${participant.identity} · ${trackLabel(publication)}`);
  })
  .on(RoomEvent.ParticipantAttributesChanged, (changed) => {
    const state = changed[cfg.agentStateAttribute];
    // Drawn as spans on the console timeline, which is where the
    // listening → thinking → speaking rhythm of a call becomes readable.
    if (state) addEvent("agent.state", state);
  })
  .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
    if (topic === cfg.metricsTopic) {
      try {
        metricsRaw.push({ at: Date.now(), raw: JSON.parse(new TextDecoder().decode(payload)) });
      } catch {
        addEvent("data.invalid", `unparseable payload on ${topic}`, "warn");
      }
      return;
    }
    addEvent(
      "data.received",
      `${topic || "no topic"} · ${payload.length}B${participant ? ` from ${participant.identity}` : ""}`
    );
  })
  .on(RoomEvent.DtmfReceived, (code, digit, participant) => {
    addEvent("dtmf.received", `${digit} (${code}) from ${participant.identity}`);
  })
  .on(RoomEvent.RoomMetadataChanged, (metadata) => {
    addEvent("room.metadata", metadata || "cleared");
  })
  .on(RoomEvent.RoomSidChanged, (sid) => {
    roomSid = sid || roomSid;
  })
  .on(RoomEvent.ConnectionStateChanged, (state) => {
    addEvent("connection.state", enumLabel(ConnectionState, state));
  })
  .on(RoomEvent.Reconnecting, () => addEvent("connection.reconnecting", "", "warn"))
  .on(RoomEvent.Reconnected, () => addEvent("connection.reconnected", ""))
  .on(RoomEvent.Disconnected, (reason) => {
    addEvent("room.disconnected", enumLabel(DisconnectReason, reason));
    void finalize("room closed");
  });

/**
 * Transcriptions arrive as text streams, one or more per utterance. Streams that
 * share a segment id are the same utterance being revised, so the last text wins
 * while the timestamp stays that of the first — the same rule the browser hook
 * follows, so a replayed session reads identically either way.
 */
function handleTranscription(reader, participantInfo) {
  const info = reader.info ?? {};
  void readSegment(reader, info, participantInfo);
}

/**
 * A typed message is one stream, complete on arrival — no revisions, no segment
 * id to join on — so it is recorded as its own line and marked as text.
 */
function handleChat(reader, participantInfo) {
  const info = reader.info ?? {};
  void readSegment(reader, info, participantInfo, "text");
}

/** Reads still in flight when the room closes; finalize waits on them briefly. */
const pendingReads = new Set();

function readSegment(reader, info, participantInfo, via = "voice") {
  const id =
    via === "text"
      ? `chat-${info.streamId || segments.size}`
      : info.attributes?.[cfg.segmentAttribute] || info.streamId || `seg-${segments.size}`;
  const identity = participantInfo?.identity ?? "unknown";
  const existing = segments.get(id);
  const at = existing?.at ?? utteranceStart(info.timestamp);

  segments.set(id, {
    id,
    at,
    identity,
    text: existing?.text ?? "",
    isAgent: !!agentIdentity && identity === agentIdentity,
    via,
    order: existing?.order ?? segments.size,
  });

  const read = reader
    .readAll()
    .then((text) => {
      const line = segments.get(id);
      if (!line) return;
      // A revision can only be an improvement; an empty one is not.
      if (text) line.text = text;
      // The agent may not have been identified when the stream opened.
      line.isAgent = !!agentIdentity && line.identity === agentIdentity;
    })
    .catch((err) => addEvent("transcription.error", messageOf(err), "warn"))
    .finally(() => pendingReads.delete(read));

  pendingReads.add(read);
}

/**
 * The sender stamps a stream with its own clock, which is both accurate — agents
 * run beside the dashboard — and earlier than the moment the text arrives here.
 * An implausible value falls back to arrival, because a wrong timestamp drags
 * the whole timeline out of shape.
 */
function utteranceStart(sentAt) {
  const now = Date.now();
  const sent = Number(sentAt);
  return Number.isFinite(sent) && sent > 0 && Math.abs(now - sent) <= 60_000 ? sent : now;
}

/* ── Lifecycle ──────────────────────────────────────────────────────────── */

let finalized = false;
let emptySince = null;
let watchdog = null;

async function finalize(reason) {
  if (finalized) return;
  finalized = true;
  audioStopped = true;
  if (watchdog) clearInterval(watchdog);

  log(`finalizing — ${reason}`);
  addEvent("session.captured", reason);

  // A segment whose text was still arriving would otherwise be dropped, and the
  // last thing said in a call is exactly the segment most likely to be in
  // flight. Bounded, because a read that lost its connection never resolves.
  if (pendingReads.size > 0) {
    await Promise.race([
      Promise.allSettled([...pendingReads]),
      new Promise((resolve) => setTimeout(resolve, 1500)),
    ]);
  }

  let audio = null;
  if (mixer && wav) {
    const { durationMs } = mixer.finish();
    const { bytes } = wav.close();
    mixer = null;
    wav = null;

    if (durationMs >= cfg.minAudioMs) {
      fs.renameSync(wavPartPath, wavPath);
      audio = {
        file: path.basename(wavPath),
        mimeType: "audio/wav",
        durationMs,
        startedAtMs: audioStartedAt,
        bytes,
      };
    } else {
      try {
        fs.unlinkSync(wavPartPath);
      } catch {}
    }
  }

  try {
    await room.disconnect();
  } catch {}

  const transcript = [...segments.values()]
    .sort((a, b) => a.at - b.at || a.order - b.order)
    .filter((line) => line.text)
    // `order` is only a tiebreaker for segments stamped the same millisecond.
    .map(({ id, at, identity, text, isAgent, via }) => ({ id, at, identity, text, isAgent, via }));

  // Nothing was said and nothing happened: a connect that went nowhere is noise
  // in the history list, exactly as it is for the console.
  if (transcript.length === 0 && events.length <= 2) {
    log("nothing worth saving");
    if (audio) {
      try {
        fs.unlinkSync(wavPath);
      } catch {}
    }
    clearRecord();
    process.exit(0);
  }

  const endedAt = Date.now();
  const capture = {
    version: 1,
    source: "observer",
    captureId: cfg.captureId,
    agentName: agentName || "unknown",
    room: cfg.room,
    roomSid,
    talkMode,
    startedAt: cfg.startedAt,
    endedAt,
    durationMs: Math.max(0, endedAt - cfg.startedAt),
    participants: peakParticipants,
    agentIdentity,
    serverUrl: cfg.serverUrl,
    consoleWasPresent: consoleSeen,
    events,
    metricsRaw,
    transcript,
    audio,
  };

  const jsonPath = path.join(cfg.outDir, `${cfg.captureId}.json`);
  const tmpPath = `${jsonPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(capture));
  // The rename is the commit: the adopter only ever sees a whole capture.
  fs.renameSync(tmpPath, jsonPath);

  log(
    `saved ${transcript.length} transcript lines, ${events.length} events, ` +
      `${metricsRaw.length} metrics${audio ? `, ${Math.round(audio.durationMs / 1000)}s audio` : ""}`
  );
  clearRecord();
  process.exit(0);
}

function messageOf(err) {
  return err instanceof Error ? err.message : String(err);
}

/** This process is done; the supervisor should not see a record for it. */
function clearRecord() {
  if (!cfg.recordFile) return;
  try {
    fs.unlinkSync(cfg.recordFile);
  } catch {}
}

async function main() {
  startAudio();
  room.registerTextStreamHandler(cfg.transcriptionTopic, handleTranscription);
  room.registerTextStreamHandler(cfg.chatTopic, handleChat);

  log(`connecting to ${cfg.url}`);
  await room.connect(cfg.url, cfg.token, { autoSubscribe: true, dynacast: false });
  addEvent("session.observing", `hidden observer joined ${cfg.room}`);

  // Whoever is already here — the webhook can easily land after the agent and
  // the caller have both joined.
  for (const participant of room.remoteParticipants.values()) {
    const kind = noteParticipant(participant);
    addEvent("participant.present", `${participant.identity} (${kind})`);
    noteInitialAgentState(participant);
  }
  peakParticipants = Math.max(peakParticipants, room.remoteParticipants.size);

  watchdog = setInterval(() => {
    if (Date.now() - cfg.startedAt > cfg.maxMs) {
      void finalize(`capture limit of ${cfg.maxMs / 60_000} minutes reached`);
      return;
    }

    // An empty room must not keep this process — or the room itself — alive.
    if (room.remoteParticipants.size === 0) {
      emptySince ??= Date.now();
      if (Date.now() - emptySince > cfg.idleExitMs) void finalize("room empty");
    } else {
      emptySince = null;
      peakParticipants = Math.max(peakParticipants, room.remoteParticipants.size);
    }
  }, 2000);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => void finalize(`received ${signal}`));
}
process.on("uncaughtException", (err) => {
  console.error(`[observer ${cfg.room}] crashed:`, err);
  addEvent("session.error", messageOf(err), "error");
  void finalize("observer crashed");
});

main().catch((err) => {
  console.error(`[observer ${cfg.room}] could not observe:`, err);
  // A capture with no room is not worth a history row, but the log line above
  // is how the supervisor's log file explains itself. Take the empty recording
  // with it, or a server that keeps refusing the token litters the capture dir.
  try {
    wav?.close();
    fs.unlinkSync(wavPartPath);
  } catch {}
  clearRecord();
  process.exit(1);
});
