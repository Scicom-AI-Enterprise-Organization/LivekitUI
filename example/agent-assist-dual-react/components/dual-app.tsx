'use client';

import { useEffect, useRef, useState } from 'react';
import { useDualCall, type DualCall } from '@/lib/use-dual-call';
import {
  AGENT_TRACK,
  CUSTOMER_TRACK,
  ROLE_LABEL,
  type DualConfig,
  type RoomState,
} from '@/lib/types';
import { AudioBars } from './audio-bars';
import { Composer } from './composer';
import { SuggestionPanel } from './suggestion-panel';
import { TranscriptPanel } from './transcript-panel';

export function DualApp({ config }: { config: DualConfig }) {
  const audioRef = useRef<HTMLDivElement | null>(null);
  const call = useDualCall(audioRef);
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState('');

  return (
    <div className="shell">
      <div className="topbar">
        <h1>Agent assist · dual track</h1>
        <span className="pill">
          <span className="dot" />
          {config.roomName}
        </span>
        {call.phase === 'joined' && (
          <>
            <span className={`pill ${call.workerPresent ? 'on' : 'off'}`}>
              <span className="dot" />
              {call.workerPresent ? 'Worker connected' : 'Waiting for worker'}
            </span>
            <span className={`pill ${call.micEnabled ? 'on' : 'off'}`}>
              <span className="dot agent" />
              {ROLE_LABEL.agent}
              {call.micEnabled ? ' on air' : ' muted'}
            </span>
            <span className={`pill ${call.customerLive ? 'on' : 'off'}`}>
              <span className="dot customer" />
              {ROLE_LABEL.customer}
              {call.customerLive ? ' on air' : ' not shared'}
            </span>
          </>
        )}
        <span className="spacer" />
        {call.phase === 'joined' && <Controls call={call} />}
      </div>

      {call.phase === 'joined' ? (
        <Live call={call} config={config} />
      ) : (
        <JoinForm
          config={config}
          name={name}
          customer={customer}
          onName={setName}
          onCustomer={setCustomer}
          connecting={call.connecting}
          error={call.error}
          onJoin={() => call.join({ name, customer, room: config.roomName })}
        />
      )}

      {/* Remote audio is attached here — hidden, but it has to be in the DOM. */}
      <div className="hidden-audio" ref={audioRef} />
    </div>
  );
}

/**
 * Going on air, and the level meters for it.
 *
 * The meters are not decoration. An empty transcript cannot tell a microphone
 * that never opened from a share carrying no audio from a worker that never
 * joined — and on this template there are two ways for the audio to be wrong
 * instead of one. A bar that moves is the only thing on screen that says a leg is
 * really reaching the room.
 */
function Controls({ call }: { call: DualCall }) {
  return (
    <div className="controls">
      <AudioBars track={call.micTrack} muted={!call.micEnabled} label="You" />
      {call.customerTrack && <AudioBars track={call.customerTrack} label="Customer" />}
      {/* A monitor publishes nothing, so these are the desk's legs seen from the
          outside — and the only meters they get. */}
      {call.remoteLegs.map((leg) => (
        <AudioBars key={leg.key} track={leg.track} label={leg.label} />
      ))}
      <button onClick={() => void call.toggleMic()}>
        {call.micEnabled ? 'Mute' : 'Unmute'}
      </button>
      {call.customerLive ? (
        <button onClick={() => void call.stopCustomerAudio()}>Stop sharing</button>
      ) : (
        <button className="primary" onClick={() => void call.shareCustomerAudio()}>
          Share customer audio
        </button>
      )}
      <button className="danger" onClick={call.leave}>
        Leave
      </button>
    </div>
  );
}

function JoinForm({
  config,
  name,
  customer,
  onName,
  onCustomer,
  connecting,
  error,
  onJoin,
}: {
  config: DualConfig;
  name: string;
  customer: string;
  onName: (v: string) => void;
  onCustomer: (v: string) => void;
  connecting: boolean;
  error: string | null;
  onJoin: () => void;
}) {
  const [state, setState] = useState<RoomState>({ publishers: [], workerPresent: false });

  // What is already on air, so someone opening the link can see whether a call is
  // being captured before joining. After joining, room events replace this.
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

  const onAir = state.publishers.flatMap((p) => p.legs);

  return (
    <div className="center">
      <div className="card">
        <h2>Take the desk</h2>
        <p className="sub">
          You publish both sides of the call from this one browser: your microphone, and the
          softphone&apos;s audio as a shared tab. Or join and publish nothing, to watch a desk
          someone else is running.
        </p>

        {error && <div className="notice error">{error}</div>}
        {!config.agentName && (
          <div className="notice info">
            This sandbox has no assist worker, so nothing will transcribe the call. Deploy one from
            the Sandboxes page.
          </div>
        )}
        {onAir.length > 0 && (
          <div className="notice info">
            Already on air in this room:{' '}
            {onAir.map((leg) => leg.trackName).join(', ')}. Joining now makes you a monitor unless
            you publish too.
          </div>
        )}

        <div className="field">
          <label htmlFor="dual-name">Your name</label>
          <input
            id="dual-name"
            value={name}
            placeholder="e.g. Aina"
            maxLength={40}
            onChange={(e) => onName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onJoin();
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="dual-customer">Who is on the line? (optional)</label>
          <input
            id="dual-customer"
            value={customer}
            placeholder="e.g. +60 12-345 6789"
            maxLength={40}
            onChange={(e) => onCustomer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) onJoin();
            }}
          />
          <p className="hint">
            Labels the customer&apos;s half of the transcript. Set now rather than mid-call: the
            worker reads it when it starts that leg, so a later change would not reach a leg already
            running.
          </p>
        </div>

        <div className="controls">
          <button className="primary" onClick={onJoin} disabled={connecting || !name.trim()}>
            {connecting ? <span className="spin" /> : null}
            {connecting ? ' Joining…' : 'Join'}
          </button>
          <button onClick={() => navigator.clipboard?.writeText(window.location.href)}>
            Copy link
          </button>
        </div>
      </div>
    </div>
  );
}

/** Why the transcript is empty, which matters more than the fact that it is. */
function emptyReason(call: DualCall, config: DualConfig) {
  if (!config.agentName) {
    return <>This sandbox has no assist worker, so nothing is transcribed. You can still type.</>;
  }

  if (!call.workerPresent) {
    return (
      <>
        <div className="worker-warning">
          The worker <code>{config.agentName}</code> is not in this call, so nothing is transcribing
          it.
          {call.workerError && <div style={{ marginTop: '0.35rem' }}>{call.workerError}</div>}
          <button onClick={() => void call.retryWorker()}>Dispatch it now</button>
        </div>
      </>
    );
  }

  if (call.workerError) {
    return (
      <div className="worker-warning">
        The worker is in the call but not transcribing it.
        <div style={{ marginTop: '0.35rem' }}>{call.workerError}</div>
      </div>
    );
  }

  // The worker is here and healthy, so anything missing now is a leg that is not
  // on air. Naming which one is the whole point — "say something" was a lie when
  // the real answer was that the customer side was never shared.
  const publishing = call.micEnabled || call.customerLive;
  const monitoring = !publishing && call.remoteLegs.length > 0;

  if (monitoring) {
    return <>Watching this desk. Lines appear as they are spoken.</>;
  }

  if (!publishing) {
    return (
      <div className="worker-warning">
        Nothing is on air. Unmute to publish your side as <code>{AGENT_TRACK}</code>, and share the
        softphone tab to publish the caller as <code>{CUSTOMER_TRACK}</code>.
      </div>
    );
  }

  if (!call.customerLive) {
    return (
      <div className="worker-warning">
        Only your microphone is on air. The caller is not being captured — share the tab your
        softphone is in, with its audio, or the transcript will only ever hold your half of the
        call.
      </div>
    );
  }

  if (!call.micEnabled) {
    return (
      <div className="worker-warning">
        Only the caller is on air. Unmute to have your own side transcribed too — the coaching reads
        both halves.
      </div>
    );
  }

  return <>Both legs are on air. Lines appear as they are spoken.</>;
}

function Live({ call, config }: { call: DualCall; config: DualConfig }) {
  const captureHint = (
    <>
      {call.micError && <div className="worker-warning">{call.micError}</div>}
      {call.customerError && <div className="worker-warning">{call.customerError}</div>}
    </>
  );

  return (
    <div className="stage">
      <TranscriptPanel
        lines={call.transcript}
        title="Conversation"
        empty={emptyReason(call, config)}
        header={captureHint}
        footer={<Composer onSend={call.sendMessage} />}
      />
      <SuggestionPanel
        suggestions={call.suggestions}
        enabled={Boolean(config.agentName) && call.workerPresent}
      />
    </div>
  );
}
