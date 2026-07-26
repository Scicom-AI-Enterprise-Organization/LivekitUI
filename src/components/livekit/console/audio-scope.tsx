"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Audio scope — a scrolling level history plus a live waveform, read straight
 * off the track with a Web Audio analyser.
 *
 * The bar visualizers in @livekit/components-react animate agent *state*, not
 * signal, so they look identical whether audio is flowing or not. This draws
 * the actual samples, which is what a console needs.
 */

const HISTORY = 240; // level samples kept, ~8s at 30fps

export function AudioScope({
  track,
  color = "#38bdf8",
  label,
  className,
  height = 64,
}: {
  /** Live media track to analyse; undefined renders an idle scope. */
  track?: MediaStreamTrack;
  color?: string;
  label?: string;
  className?: string;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [peak, setPeak] = useState(0);
  const [rms, setRms] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;

    const history = new Array<number>(HISTORY).fill(0);
    let raf = 0;
    let audioCtx: AudioContext | undefined;
    let source: MediaStreamAudioSourceNode | undefined;
    let analyser: AnalyserNode | undefined;
    // Explicit ArrayBuffer backing: getFloatTimeDomainData rejects a possibly
    // SharedArrayBuffer-backed view.
    let samples: Float32Array<ArrayBuffer> | undefined;
    let lastPush = 0;
    let lastReport = 0;

    if (track) {
      const AudioCtor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioCtor) {
        audioCtx = new AudioCtor();
        // A muted destination keeps Chrome from garbage-collecting the graph
        // without double-playing the audio (RoomAudioRenderer already plays it).
        source = audioCtx.createMediaStreamSource(new MediaStream([track]));
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        samples = new Float32Array(analyser.fftSize);
        void audioCtx.resume().catch(() => {});
      }
    }

    const draw = (time: number) => {
      raf = requestAnimationFrame(draw);

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.clientWidth;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx2d.clearRect(0, 0, width, height);

      let level = 0;
      if (analyser && samples) {
        analyser.getFloatTimeDomainData(samples);
        let sum = 0;
        let max = 0;
        for (let i = 0; i < samples.length; i++) {
          const v = samples[i];
          sum += v * v;
          const abs = Math.abs(v);
          if (abs > max) max = abs;
        }
        const frameRms = Math.sqrt(sum / samples.length);
        // Perceptual-ish curve: raw RMS on a linear axis is nearly invisible.
        level = Math.min(1, Math.sqrt(frameRms) * 1.8);

        if (time - lastReport > 100) {
          lastReport = time;
          setRms(frameRms);
          setPeak(max);
        }
      }

      // ~30fps history, independent of the render rate.
      if (time - lastPush > 33) {
        lastPush = time;
        history.push(level);
        history.shift();
      }

      // Level history — mirrored around the centre line.
      const mid = height / 2;
      const barW = width / HISTORY;
      ctx2d.fillStyle = color;
      for (let i = 0; i < HISTORY; i++) {
        const h = Math.max(1, history[i] * (height - 6));
        ctx2d.globalAlpha = 0.35 + history[i] * 0.65;
        ctx2d.fillRect(i * barW, mid - h / 2, Math.max(1, barW - 0.6), h);
      }
      ctx2d.globalAlpha = 1;

      // Live waveform on top of the most recent slice.
      if (analyser && samples) {
        ctx2d.strokeStyle = color;
        ctx2d.lineWidth = 1;
        ctx2d.globalAlpha = 0.9;
        ctx2d.beginPath();
        const step = Math.max(1, Math.floor(samples.length / Math.max(1, width)));
        for (let x = 0, i = 0; i < samples.length; i += step, x++) {
          const y = mid - samples[i] * (height / 2 - 2);
          if (x === 0) ctx2d.moveTo(x, y);
          else ctx2d.lineTo(x, y);
        }
        ctx2d.stroke();
        ctx2d.globalAlpha = 1;
      }

      // Centre line
      ctx2d.strokeStyle = "rgba(128,128,128,0.35)";
      ctx2d.lineWidth = 1;
      ctx2d.beginPath();
      ctx2d.moveTo(0, mid + 0.5);
      ctx2d.lineTo(width, mid + 0.5);
      ctx2d.stroke();
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      try {
        source?.disconnect();
        analyser?.disconnect();
        void audioCtx?.close();
      } catch {}
    };
  }, [track, color, height]);

  return (
    <div className={cn("space-y-1", className)}>
      <canvas ref={canvasRef} className="w-full" style={{ height }} />
      <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span>{label ?? ""}</span>
        <span>
          {track
            ? `rms ${toDb(rms)} · peak ${toDb(peak)}`
            : "no track"}
        </span>
      </div>
    </div>
  );
}

function toDb(amplitude: number): string {
  if (!amplitude || amplitude <= 0.0001) return "−∞ dB";
  return `${(20 * Math.log10(amplitude)).toFixed(1)} dB`;
}
