'use client';

import { useEffect, useRef, useState } from 'react';
import { useAssistCall, type AssistCall } from '@/lib/use-assist-call';
import {
  otherRole,
  ROLE_LABEL,
  ROLES,
  type AssistConfig,
  type Role,
  type RoomState,
} from '@/lib/types';
import { AudioBars } from './audio-bars';
import { Composer } from './composer';
import { SuggestionPanel } from './suggestion-panel';
import { TranscriptPanel } from './transcript-panel';

/** The other person's display name, for their level meter. */
function otherSeatName(call: AssistCall): string {
  const mine = call.me?.role;
  return call.seats.find((s) => s.role !== mine)?.name ?? 'Them';
}

const SEAT_BLURB: Record<Role, string> = {
  agent: 'You take the call. You see both transcripts and the live coaching.',
  customer: 'You are the caller. You just talk.',
};

export function AssistApp({ config }: { config: AssistConfig }) {
  const audioRef = useRef<HTMLDivElement | null>(null);
  const call = useAssistCall(audioRef);
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('agent');

  return (
    <div className="shell">
      <div className="topbar">
        <h1>Agent assist</h1>
        <span className="pill">
          <span className="dot" />
          {config.roomName}
        </span>
        {call.phase !== 'idle' && (
          <>
            <span className={`pill ${call.workerPresent ? 'on' : 'off'}`}>
              <span className="dot" />
              {call.workerPresent ? 'Assist worker connected' : 'Waiting for assist worker'}
            </span>
            {call.seats.map((s) => (
              <span key={s.identity} className="pill on">
                <span className="dot" />
                {s.name} · {ROLE_LABEL[s.role]}
              </span>
            ))}
          </>
        )}
        <span className="spacer" />
        {call.phase !== 'idle' && (
          <div className="controls">
            {/* The only thing on screen that shows your voice is reaching the
                room. An empty transcript cannot tell a dead microphone from a
                worker that never joined. */}
            <AudioBars track={call.micTrack} muted={!call.micEnabled} label="You" />
            {call.remoteTrack && (
              <AudioBars track={call.remoteTrack} label={otherSeatName(call)} />
            )}
            <button onClick={call.toggleMic}>{call.micEnabled ? 'Mute' : 'Unmute'}</button>
            <button className="danger" onClick={call.leave}>
              Leave
            </button>
          </div>
        )}
      </div>

      {call.phase === 'idle' || call.phase === 'connecting' ? (
        <JoinForm
          config={config}
          name={name}
          role={role}
          onName={setName}
          onRole={setRole}
          connecting={call.connecting}
          error={call.error}
          onJoin={() => call.join({ name, role, room: config.roomName })}
        />
      ) : call.phase === 'waiting' ? (
        <Lobby waitingFor={otherRole(call.me?.role ?? role)} />
      ) : (
        <Live call={call} config={config} />
      )}

      {/* Remote audio is attached here — hidden, but it has to be in the DOM. */}
      <div className="hidden-audio" ref={audioRef} />
    </div>
  );
}

function JoinForm({
  config,
  name,
  role,
  onName,
  onRole,
  connecting,
  error,
  onJoin,
}: {
  config: AssistConfig;
  name: string;
  role: Role;
  onName: (v: string) => void;
  onRole: (v: Role) => void;
  connecting: boolean;
  error: string | null;
  onJoin: () => void;
}) {
  const [state, setState] = useState<RoomState>({ seats: [], workerPresent: false });

  // Who is already here, so a seat can be shown as taken before anyone joins.
  // After joining, room events replace this — this poll is only for the form.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`/api/room-state?room=${encodeURIComponent(config.roomName)}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((data: RoomState) => {
          if (!cancelled) setState(data);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [config.roomName]);

  const takenBy = (r: Role) => state.seats.find((s) => s.role === r)?.name ?? null;
  const blocked = takenBy(role) !== null;

  return (
    <div className="center">
      <div className="card">
        <h2>Join the call</h2>
        <p className="sub">
          Two people, one link. Open it in another window, tab or machine for the other side.
        </p>

        {error && <div className="notice error">{error}</div>}
        {!config.agentName && (
          <div className="notice info">
            This sandbox has no assist worker, so nothing will transcribe the call. Deploy one from
            the Sandboxes page.
          </div>
        )}

        <div className="field">
          <label htmlFor="assist-name">Your name</label>
          <input
            id="assist-name"
            value={name}
            placeholder="e.g. Aina"
            maxLength={40}
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim() && !blocked) onJoin();
            }}
          />
        </div>

        <div className="field">
          <label>Which side are you on?</label>
          <div className="seat-choice">
            {ROLES.map((r) => {
              const taken = takenBy(r);
              return (
                <button
                  key={r}
                  className="seat"
                  aria-pressed={role === r}
                  onClick={() => onRole(r)}
                  disabled={taken !== null}
                >
                  <span className={`dot ${r}`} />
                  <span>
                    <span className="who">{ROLE_LABEL[r]}</span>
                    <br />
                    {taken ? (
                      <span className="taken">Taken by {taken}</span>
                    ) : (
                      <span className="free">{SEAT_BLURB[r]}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="controls">
          <button className="primary" onClick={onJoin} disabled={connecting || !name.trim() || blocked}>
            {connecting ? <span className="spin" /> : null}
            {connecting ? ' Joining…' : `Join as ${ROLE_LABEL[role].toLowerCase()}`}
          </button>
          <button onClick={() => navigator.clipboard?.writeText(window.location.href)}>
            Copy link
          </button>
        </div>
      </div>
    </div>
  );
}

function Lobby({ waitingFor }: { waitingFor: Role }) {
  return (
    <div className="center">
      <div className="card">
        <h2>
          <span className="spin" /> Waiting for the {ROLE_LABEL[waitingFor].toLowerCase()}
        </h2>
        <p className="sub">
          You are in. The call starts as soon as they open the same link and take the other seat —
          nothing is transcribed until both of you are here.
        </p>
        <div className="controls">
          <button onClick={() => navigator.clipboard?.writeText(window.location.href)}>
            Copy link to share
          </button>
        </div>
      </div>
    </div>
  );
}

function Live({ call, config }: { call: AssistCall; config: AssistConfig }) {
  const isAgent = call.me?.role === 'agent';
  const composer = (
    <>
      {call.micError && (
        <div className="worker-warning" style={{ margin: '0.7rem 0.95rem 0' }}>
          {call.micError} Nothing you say will be transcribed until it works — you can still type.
        </div>
      )}
      <Composer onSend={call.sendMessage} />
    </>
  );

  // The old empty state said "say something", which is a lie when the reason
  // nothing appears is that no worker is in the room. Name the actual reason.
  const empty = !config.agentName ? (
    <>This sandbox has no assist worker, so speech is not transcribed. You can still talk and type.</>
  ) : call.workerPresent && call.workerError ? (
    <div className="worker-warning">
      The assist worker is in the call but not transcribing it.
      <div style={{ marginTop: '0.35rem' }}>{call.workerError}</div>
    </div>
  ) : !call.workerPresent ? (
    <>
      <div className="worker-warning">
        The assist worker <code>{config.agentName}</code> is not in this call, so nothing is
        transcribing it.
        {call.workerError && <div style={{ marginTop: '0.35rem' }}>{call.workerError}</div>}
        <button onClick={() => void call.retryWorker()}>Dispatch it now</button>
      </div>
      Typed messages still reach the other person.
    </>
  ) : (
    <>Connected and listening. Say something, or type below.</>
  );

  // Both sides see the whole conversation — anything typed or said by the other
  // person included. Showing the customer only their own words meant a message
  // the support agent typed to them arrived nowhere, and the transcript of a call
  // they are on is not a secret. The one thing that stays private is the coaching
  // panel, which is the entire point of it.
  const transcript = (
    <TranscriptPanel
      lines={call.transcript}
      title="Conversation"
      empty={empty}
      footer={composer}
    />
  );

  if (!isAgent) {
    return <div className="stage solo">{transcript}</div>;
  }

  return (
    <div className="stage">
      {transcript}
      <SuggestionPanel
        suggestions={call.suggestions}
        enabled={Boolean(config.agentName) && call.workerPresent}
      />
    </div>
  );
}
