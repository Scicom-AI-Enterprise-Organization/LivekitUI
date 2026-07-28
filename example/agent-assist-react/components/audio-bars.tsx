'use client';

import { useEffect, useRef } from 'react';

/**
 * A live level meter for one audio track.
 *
 * It exists to answer a question the transcript cannot: *is my voice reaching the
 * room at all?* Without it, a microphone that never opened, a muted track and a
 * broken transcription pipeline all look identical — an empty panel.
 *
 * Owns its own AnimationFrame loop and writes bar heights straight to the DOM, so
 * it never re-renders the panels around it.
 */
export function AudioBars({
  track,
  bars = 9,
  label,
  muted = false,
}: {
  track: MediaStreamTrack | null;
  bars?: number;
  label?: string;
  muted?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !track || muted) return;

    // Safari still needs the prefix, and a suspended context produces silence
    // rather than an error — which would read as "my microphone is dead".
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    void ctx.resume().catch(() => undefined);

    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.7;
    source.connect(analyser);
    // Deliberately not connected to ctx.destination: for the local microphone
    // that would be an echo of yourself, and remote audio is already played by
    // the element the SDK attached.

    const data = new Uint8Array(analyser.frequencyBinCount);
    const elements = Array.from(container.children) as HTMLElement[];
    let frame = 0;

    const draw = () => {
      analyser.getByteFrequencyData(data);
      // One band per bar, low frequencies first — speech lives at the left.
      const perBar = Math.max(1, Math.floor(data.length / (elements.length * 2)));
      elements.forEach((el, i) => {
        let sum = 0;
        for (let j = 0; j < perBar; j++) sum += data[i * perBar + j] ?? 0;
        const level = sum / perBar / 255;
        el.style.height = `${Math.max(8, Math.round(level * 100))}%`;
        el.style.opacity = String(0.35 + level * 0.65);
      });
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      try {
        source.disconnect();
      } catch {}
      void ctx.close().catch(() => undefined);
      elements.forEach((el) => {
        el.style.height = '8%';
        el.style.opacity = '0.35';
      });
    };
  }, [track, muted]);

  return (
    <div className="meter" title={label}>
      <div className={`bars${muted || !track ? ' idle' : ''}`} ref={containerRef}>
        {Array.from({ length: bars }, (_, i) => (
          <span key={i} />
        ))}
      </div>
      {label && <span className="meter-label">{label}</span>}
    </div>
  );
}
