'use client';

import { useState } from 'react';
import { ROLE_LABEL, ROLES, type Role } from '@/lib/types';

/**
 * Type a turn, as either side.
 *
 * Messages go out on `lk.chat` with the side stamped on the stream, because the
 * sender's identity cannot say which one: this participant carries both voices.
 *
 * The **customer** option is not a novelty. It is the only way to exercise the
 * worker without a phone on the other end — one typed customer line runs the same
 * path a spoken turn does, all the way to a coaching note — and it is how you
 * check that the coaching model is reachable before trusting a real call to it.
 */
export function Composer({
  onSend,
  defaultRole = 'agent',
}: {
  onSend: (text: string, role: Role) => Promise<void>;
  defaultRole?: Role;
}) {
  const [text, setText] = useState('');
  const [role, setRole] = useState<Role>(defaultRole);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError('');
    try {
      await onSend(trimmed, role);
      setText('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="composer">
      <div className="role-toggle">
        {ROLES.map((r) => (
          <button
            key={r}
            className={`chip ${r}`}
            aria-pressed={role === r}
            onClick={() => setRole(r)}
            title={`Send as the ${ROLE_LABEL[r].toLowerCase()}`}
          >
            {ROLE_LABEL[r]}
          </button>
        ))}
      </div>
      <input
        value={text}
        placeholder={`Type as the ${ROLE_LABEL[role].toLowerCase()}…`}
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
