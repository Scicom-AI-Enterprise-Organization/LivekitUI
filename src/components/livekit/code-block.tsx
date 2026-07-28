"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A command the reader is meant to run: monospaced, scrollable rather than
 * wrapped (a wrapped shell line cannot be trusted), and one click to copy.
 */
export function CodeBlock({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className={cn("relative", className)}>
      <pre className="overflow-x-auto whitespace-pre rounded-lg border bg-background/60 p-3 pr-9 font-mono text-[11px] leading-relaxed text-foreground/90">
        {code}
      </pre>
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute right-1.5 top-1.5"
        title="Copy"
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? <Check className="size-3 text-green-500" /> : <Copy className="size-3" />}
      </Button>
    </div>
  );
}
