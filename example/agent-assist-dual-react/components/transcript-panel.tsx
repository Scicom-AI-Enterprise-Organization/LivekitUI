'use client';

import { useEffect, useRef } from 'react';
import { ROLE_LABEL, type TranscriptLine } from '@/lib/types';

/**
 * Both sides of the call on one axis, in the order they arrived — spoken lines
 * from the worker's transcription of each track, typed ones straight off the chat
 * topic.
 */
export function TranscriptPanel({
  lines,
  title,
  empty,
  header,
  footer,
}: {
  lines: TranscriptLine[];
  title: string;
  /** What to say when there is nothing yet — the reason matters more than the fact. */
  empty: React.ReactNode;
  /**
   * Shown above the lines, and unlike `empty` it is shown whether or not there
   * are any. A capture that broke halfway through a call has to be visible while
   * the transcript already holds the first half of it.
   */
  header?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);

  const shown = lines;
  // A growing partial changes no line count, so the text of the last line is
  // what tells us there is more to scroll to.
  const lastText = shown[shown.length - 1]?.text ?? '';

  // Follow the conversation, but stop fighting someone who has scrolled up to
  // re-read something.
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || !pinnedRef.current) return;
    body.scrollTop = body.scrollHeight;
  }, [shown.length, lastText]);

  const onScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    pinnedRef.current = body.scrollHeight - body.scrollTop - body.clientHeight < 48;
  };

  return (
    <section className="panel">
      <header>{title}</header>
      <div className="body" ref={bodyRef} onScroll={onScroll}>
        {header}
        {shown.length === 0 ? (
          <div className="empty">{empty}</div>
        ) : (
          shown.map((line) => (
            <div key={line.id} className={`line ${line.role}${line.final ? '' : ' partial'}`}>
              <div className="bar" />
              <div>
                <div className="who">
                  {line.name} · {ROLE_LABEL[line.role]}
                  {line.via === 'text' && <span className="typed">typed</span>}
                </div>
                <div className="text">{line.text}</div>
              </div>
            </div>
          ))
        )}
      </div>
      {footer}
    </section>
  );
}
