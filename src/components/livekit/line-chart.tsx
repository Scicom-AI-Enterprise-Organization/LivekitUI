"use client";

import { cn } from "@/lib/utils";

interface LineChartProps {
  data: number[];
  labels?: string[];
  height?: number;
  color?: string;
  fillColor?: string;
  className?: string;
  showDots?: boolean;
  dashed?: boolean;
  viewBoxWidth?: number;
  fontSize?: number;
}

export function LineChart({
  data,
  labels,
  height = 120,
  color = "var(--primary)",
  fillColor,
  className,
  showDots = false,
  dashed = false,
  viewBoxWidth = 600,
  fontSize = 9,
}: LineChartProps) {
  if (data.length === 0) return null;

  const padding = { top: 10, right: 10, bottom: 25, left: 30 };
  const width = viewBoxWidth;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const max = Math.max(...data, 1);
  const min = 0;
  const range = max - min || 1;

  const points = data.map((d, i) => ({
    x: padding.left + (i / Math.max(data.length - 1, 1)) * chartWidth,
    y: padding.top + chartHeight - ((d - min) / range) * chartHeight,
  }));

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");

  const areaD = `${pathD} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${points[0].x} ${padding.top + chartHeight} Z`;

  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => min + (range / yTicks) * i);

  return (
    <div className={cn("w-full", className)}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {yTickValues.map((tick, i) => {
          const y = padding.top + chartHeight - ((tick - min) / range) * chartHeight;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                className="stroke-border"
                strokeWidth="0.5"
              />
              <text
                x={padding.left - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                fontSize={fontSize}
                fontFamily="var(--font-sans)"
              >
                {tick >= 1000000 ? `${(tick / 1000000).toFixed(0)}M` : tick >= 1000 ? `${(tick / 1000).toFixed(0)}k` : tick.toFixed(0)}
              </text>
            </g>
          );
        })}

        {fillColor && (
          <path d={areaD} fill={fillColor} opacity="0.15" />
        )}

        <path
          d={pathD}
          fill="none"
          stroke={color}
          strokeWidth="1.5"
          strokeDasharray={dashed ? "4 3" : undefined}
          className="transition-all duration-500"
        />

        {showDots &&
          points.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r="2" fill={color} />
          ))}

        {labels &&
          (() => {
            const maxTicks = 7;
            const step = labels.length <= maxTicks ? 1 : Math.ceil(labels.length / maxTicks);
            const last = labels.length - 1;
            return labels.map((label, i) => {
              if (i === 0 || i === last) { /* always show first and last */ }
              else if (i % step !== 0) return null;
              else if (last - i < step * 0.6) return null; /* too close to last label */
              const x = padding.left + (i / Math.max(labels.length - 1, 1)) * chartWidth;
              return (
                <text
                  key={i}
                  x={x}
                  y={height - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={fontSize}
                  fontFamily="var(--font-sans)"
                >
                  {label}
                </text>
              );
            });
          })()}
      </svg>
    </div>
  );
}

interface MultiLineChartProps {
  series: { data: number[]; color: string; label: string; dashed?: boolean }[];
  labels?: string[];
  height?: number;
  className?: string;
  viewBoxWidth?: number;
  fontSize?: number;
}

export function MultiLineChart({ series, labels, height = 120, className, viewBoxWidth = 600, fontSize = 9 }: MultiLineChartProps) {
  if (series.length === 0) return null;

  const padding = { top: 10, right: 10, bottom: 25, left: 30 };
  const width = viewBoxWidth;
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const allData = series.flatMap((s) => s.data);
  const max = Math.max(...allData, 1);
  const min = 0;
  const range = max - min || 1;

  const yTicks = 4;
  const yTickValues = Array.from({ length: yTicks + 1 }, (_, i) => min + (range / yTicks) * i);

  return (
    <div className={cn("w-full", className)}>
      <div className="flex gap-4 mb-2 px-1">
        {series.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <div className="size-2 rounded-full" style={{ backgroundColor: s.color }} />
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        {yTickValues.map((tick, i) => {
          const y = padding.top + chartHeight - ((tick - min) / range) * chartHeight;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                className="stroke-border"
                strokeWidth="0.5"
              />
              <text
                x={padding.left - 4}
                y={y + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                fontSize={fontSize}
                fontFamily="var(--font-sans)"
              >
                {tick.toFixed(0)}
              </text>
            </g>
          );
        })}

        {series.map((s, si) => {
          const points = s.data.map((d, i) => ({
            x: padding.left + (i / Math.max(s.data.length - 1, 1)) * chartWidth,
            y: padding.top + chartHeight - ((d - min) / range) * chartHeight,
          }));
          const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
          return (
            <path
              key={si}
              d={pathD}
              fill="none"
              stroke={s.color}
              strokeWidth="1.5"
              strokeDasharray={s.dashed ? "4 3" : undefined}
            />
          );
        })}

        {labels &&
          (() => {
            const maxTicks = 7;
            const step = labels.length <= maxTicks ? 1 : Math.ceil(labels.length / maxTicks);
            const last = labels.length - 1;
            return labels.map((label, i) => {
              if (i === 0 || i === last) { /* always show first and last */ }
              else if (i % step !== 0) return null;
              else if (last - i < step * 0.6) return null; /* too close to last label */
              const x = padding.left + (i / Math.max(labels.length - 1, 1)) * chartWidth;
              return (
                <text
                  key={i}
                  x={x}
                  y={height - 4}
                  textAnchor="middle"
                  className="fill-muted-foreground"
                  fontSize={fontSize}
                  fontFamily="var(--font-sans)"
                >
                  {label}
                </text>
              );
            });
          })()}
      </svg>
    </div>
  );
}
