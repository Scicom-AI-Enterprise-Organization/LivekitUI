import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface StatCardProps {
  label: string;
  value: string | number;
  unit?: string;
  className?: string;
  info?: boolean;
  infoText?: string;
}

function InfoIcon({ text }: { text?: string }) {
  if (!text) return <Info className="size-3 text-muted-foreground" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-muted-foreground hover:text-foreground transition-colors">
          <Info className="size-3" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip>
  );
}

export function StatCard({ label, value, unit, className, info = true, infoText }: StatCardProps) {
  return (
    <Card className={cn("py-4", className)}>
      <CardContent className="px-5 py-0">
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-sm text-muted-foreground">
            {label}
          </span>
          {info && <InfoIcon text={infoText} />}
        </div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-semibold text-primary">{value}</span>
          {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
        </div>
      </CardContent>
    </Card>
  );
}

interface StatCardLargeProps {
  label: string;
  value: string | number;
  unit?: string;
  className?: string;
  chart?: React.ReactNode;
  infoText?: string;
}

export function StatCardLarge({ label, value, unit, className, chart, infoText }: StatCardLargeProps) {
  return (
    <Card className={cn("py-5", className)}>
      <CardContent className="px-5 py-0">
        <div className="flex items-center gap-1.5 mb-3">
          <span className="text-sm text-muted-foreground">
            {label}
          </span>
          <InfoIcon text={infoText} />
        </div>
        <div className="flex items-baseline gap-1 mb-4">
          <span className="text-3xl font-semibold text-primary">{value}</span>
          {unit && <span className="text-base text-muted-foreground">{unit}</span>}
        </div>
        {chart}
      </CardContent>
    </Card>
  );
}
