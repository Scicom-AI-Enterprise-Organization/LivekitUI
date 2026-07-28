'use client';

import { useState } from 'react';

/**
 * Type instead of talk. Messages go out on `lk.chat`, so they reach the other
 * person and the assist worker whether or not anyone's microphone is working —
 * which also makes this the way to test a call without speaking.
 */
export function Composer({ onSend }: { onSend: (text: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError('');
    try {
      await onSend(trimmed);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="composer">
      <input
        value={text}
        placeholder="Type a message…"
        maxLength={2000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
      />
      <button className="primary" onClick={() => void send()} disabled={sending || !text.trim()}>
        {sending ? <span className="spin" /> : 'Send'}
      </button>
      {error && <span className="composer-error">{error}</span>}
    </div>
  );
}
