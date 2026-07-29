'use client';

import type { Suggestion } from '@/lib/types';

const STATE_LABEL: Record<Suggestion['state'], string> = {
  thinking: 'Thinking…',
  streaming: 'Suggestion',
  done: 'Suggestion',
  error: 'Failed',
  superseded: 'Dropped',
};

/**
 * Newest note first — during a call the agent reads the top of this panel and
 * nothing else. Older ones stay, dimmed, because the previous suggestion is
 * often still the one being acted on.
 */
export function SuggestionPanel({
  suggestions,
  enabled,
}: {
  suggestions: Suggestion[];
  enabled: boolean;
}) {
  const newest = suggestions.length - 1;

  return (
    <section className="panel">
      <header>Live coaching</header>
      <div className="body">
        {!enabled ? (
          <p className="empty">
            No assist worker is in this call, so there is nothing to coach with. Use the button in
            the transcript panel to dispatch it, or check the worker on the Agents page.
          </p>
        ) : suggestions.length === 0 ? (
          <p className="empty">
            Suggestions appear here once the customer finishes a turn — spoken or typed.
          </p>
        ) : (
          suggestions
            .map((s, i) => ({ s, stale: i !== newest }))
            .reverse()
            .map(({ s, stale }) => (
              <article
                key={s.id}
                className={`suggestion${stale ? ' stale' : ''}${s.state === 'error' ? ' error' : ''}`}
              >
                <div className="meta">{STATE_LABEL[s.state]}</div>
                {s.state === 'thinking' && !s.text ? <span className="spin" /> : <div>{s.text}</div>}
              </article>
            ))
        )}
      </div>
    </section>
  );
}
