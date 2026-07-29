"use client";

import { useState } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { METRIC_KIND_LABEL, type MetricKind } from "@/lib/console-metrics";

/**
 * What the timeline means.
 *
 * Every lane here answers a different question, and the plot cannot say so on its
 * own — a bar that covers the same seconds as another one may be measuring
 * something that contains it. Two people have now read the same plot and asked
 * why EOU sits across STT and the turn detector, which is the question this
 * exists to answer: it *contains* them both.
 *
 * Shared by the live console and the replay, and collapsed by default: it is
 * reference material, not something to scroll past on every visit.
 */

/** Colours match `KIND_COLOR` in the timeline, so a swatch identifies its lane. */
const LANES: { kind: MetricKind; color: string; what: string }[] = [
  {
    kind: "eou",
    color: "#38bdf8",
    what:
      "End of utterance — the whole wait between the speaker going quiet and their turn being declared over. It contains the others: the silence the VAD waits out, the transcript round trip, and the turn detector's own call. The session reports it, so a transcriber with no LLM never produces one.",
  },
  {
    kind: "eot",
    color: "#e879f9",
    what:
      "The turn detector, one bar per prediction. A text detector reports only its round trip, so the bar is hollow; the audio detector also reports how long after the speech its verdict landed, drawn as a solid head. Typically under 200 ms — rarely what makes a turn slow.",
  },
  {
    kind: "nc",
    color: "#22d3ee",
    what:
      "Noise cancellation — off by default, like VAD: turn on the NC chip under Show to see it. One bar per window of inbound audio rather than per chunk, because the filter runs on every 50 ms the SFU delivers and reporting each would be 20 metrics a second per speaker. The windows tile the whole call, which is why the lane is hidden until asked for. The solid head is the compute inside a window: a sliver means the filter is keeping up, a bar that fills means it is adding latency to everything downstream of it. Only the self-hosted GTCRN filter reports this; Krisp does not.",
  },
  {
    kind: "stt",
    color: "#2dd4bf",
    what:
      "One segment sent to the recogniser. Solid is the speech you hear; faint either side is padding the VAD kept before it started and waited out after it stopped; the thin tail is waiting for the transcript to come back, which is where a turn usually spends its time.",
  },
  {
    kind: "llm",
    color: "#a78bfa",
    what:
      "Generating the reply. The solid head is time to first token — the part the caller waits through; the rest streamed while the agent was already speaking.",
  },
  {
    kind: "tts",
    color: "#f59e0b",
    what:
      "Heard, not computed: from the request, through the wait for the first audio (solid), then over the speech it played — which runs past the instant the metric arrived. A reply split into sentences is chained, because the pieces are heard back to back: a chunk that starts where the one before it stopped playing is drawn with no solid head at all, since its own wait for audio elapsed while the agent was still speaking and the caller sat through none of it.",
  },
  {
    kind: "interrupt",
    color: "#fb7185",
    what: "The interruption detector's own predictions, when one is in use.",
  },
  {
    kind: "vad",
    color: "#94a3b8",
    what:
      "Voice activity, when an agent publishes it. Noisy by nature — it fires a few times a second for the length of the call.",
  },
];

export function MetricsGlossary({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("rounded-lg border", className)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        <HelpCircle className="size-3" />
        What these lanes mean
        <ChevronDown
          className={cn("ml-auto size-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="space-y-3 border-t px-3 py-3 text-xs text-muted-foreground">
          <p>
            Every bar is placed by <strong className="text-foreground">when the work
            happened</strong>, not when its metric arrived — a metric is always reported after
            the thing it measures, so the plot reads against the recording rather than against
            the data channel.
          </p>

          <dl className="space-y-2">
            {LANES.map((lane) => (
              <div key={lane.kind} className="flex gap-2">
                <dt className="flex w-16 shrink-0 items-start gap-1.5 pt-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                  <span
                    className="mt-1 size-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: lane.color }}
                  />
                  {METRIC_KIND_LABEL[lane.kind]}
                </dt>
                <dd className="min-w-0">{lane.what}</dd>
              </div>
            ))}
            <div className="flex gap-2">
              <dt className="flex w-16 shrink-0 items-start gap-1.5 pt-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                <span className="mt-1 size-2 shrink-0 rounded-sm bg-muted-foreground/40" />
                Agent
              </dt>
              <dd className="min-w-0">
                What the agent said it was doing — listening, thinking, speaking — straight from
                the room. It lines up with the recording by definition, so the metric lanes are
                read against it.
              </dd>
            </div>
          </dl>

          <p>
            <strong className="text-foreground">A slow turn, in order:</strong> the VAD waits out
            a moment of silence, the recogniser answers, the turn detector decides, the model
            replies, and the voice is synthesised. The EOU bar spans the first three; on a typical
            call the recogniser is most of it and the detector is a rounding error.
          </p>

          <p className="text-muted-foreground/80">
            Speaker-split lanes (<code>STT · customer</code>) appear when a session measured more
            than one person, as an agent-assist call does. Click or drag the plot to seek;
            ⌘/ctrl-scroll zooms and shift-scroll pans.
          </p>
        </div>
      )}
    </div>
  );
}
