"use client";

export type TrendSeries = {
  key: string;
  label: string;
  color: string;
};

export type TrendPoint = {
  label: string;
  values: Record<string, number>;
};

export function LineTrendChart({
  points,
  series,
  height = 240,
}: {
  points: TrendPoint[];
  series: TrendSeries[];
  height?: number;
}) {
  const width = 720;
  const padding = { top: 16, right: 16, bottom: 34, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = Math.max(
    1,
    ...points.flatMap((point) =>
      series.map((item) => Number(point.values[item.key]) || 0)
    )
  );
  const tickCount = 4;
  const ticks = Array.from(
    new Set(
      Array.from({ length: tickCount + 1 }, (_, index) =>
        Math.round((maxValue / tickCount) * index)
      )
    )
  );
  const xFor = (index: number) =>
    points.length <= 1
      ? padding.left + plotWidth / 2
      : padding.left + (index / (points.length - 1)) * plotWidth;
  const yFor = (value: number) =>
    padding.top + plotHeight - (value / maxValue) * plotHeight;
  const labelEvery = Math.max(1, Math.ceil(points.length / 8));

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Application trend line chart"
      >
        {ticks.map((tick, index) => (
          <g key={`tick-${index}`}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
              stroke="#d1fae5"
              strokeWidth="1"
            />
            <text
              x={padding.left - 8}
              y={yFor(tick) + 4}
              textAnchor="end"
              fontSize="10"
              fill="#047857"
            >
              {tick}
            </text>
          </g>
        ))}

        {series.map((item) => {
          const coordinates = points.map((point, index) => ({
            x: xFor(index),
            y: yFor(Number(point.values[item.key]) || 0),
            value: Number(point.values[item.key]) || 0,
            label: point.label,
          }));
          const path = coordinates
            .map(
              (coordinate, index) =>
                `${index === 0 ? "M" : "L"}${coordinate.x.toFixed(1)},${coordinate.y.toFixed(1)}`
            )
            .join(" ");

          return (
            <g key={item.key}>
              <path
                d={path}
                fill="none"
                stroke={item.color}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              {coordinates.map((coordinate, index) => (
                <circle
                  key={index}
                  cx={coordinate.x}
                  cy={coordinate.y}
                  r="3.5"
                  fill="#ffffff"
                  stroke={item.color}
                  strokeWidth="2"
                >
                  <title>{`${item.label} • ${coordinate.label}: ${coordinate.value}`}</title>
                </circle>
              ))}
            </g>
          );
        })}

        {points.map((point, index) =>
          index % labelEvery === 0 || index === points.length - 1 ? (
            <text
              key={`${point.label}-${index}`}
              x={xFor(index)}
              y={height - 10}
              textAnchor="middle"
              fontSize="10"
              fill="#065f46"
            >
              {point.label}
            </text>
          ) : null
        )}
      </svg>

      <div className="mt-3 flex flex-wrap items-center gap-4">
        {series.map((item) => (
          <span
            key={item.key}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800"
          >
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export type DonutDatum = {
  label: string;
  value: number;
  color: string;
};

export function DonutChart({
  data,
  size = 176,
  thickness = 22,
  centerValue,
  centerLabel,
  emptyLabel = "No data yet",
}: {
  data: DonutDatum[];
  size?: number;
  thickness?: number;
  centerValue?: string;
  centerLabel?: string;
  emptyLabel?: string;
}) {
  const total = data.reduce((sum, item) => sum + Math.max(0, item.value), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex flex-wrap items-center gap-5">
      <div
        className="relative shrink-0"
        style={{ width: size, height: size }}
      >
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label="Distribution donut chart"
        >
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#d1fae5"
            strokeWidth={thickness}
          />
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {total > 0 &&
              data.map((item) => {
                const segment =
                  (Math.max(0, item.value) / total) * circumference;
                const circle = (
                  <circle
                    key={item.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    stroke={item.color}
                    strokeWidth={thickness}
                    strokeDasharray={`${segment} ${circumference - segment}`}
                    strokeDashoffset={-offset}
                  >
                    <title>{`${item.label}: ${item.value}`}</title>
                  </circle>
                );
                offset += segment;
                return circle;
              })}
          </g>
        </svg>

        {(centerValue || centerLabel) && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            {centerValue && (
              <span className="text-2xl font-extrabold text-emerald-950">
                {centerValue}
              </span>
            )}
            {centerLabel && (
              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">
                {centerLabel}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {data.length === 0 && (
          <p className="text-sm text-emerald-700">{emptyLabel}</p>
        )}
        {data.map((item) => (
          <div key={item.label} className="flex items-center gap-2 text-xs">
            <span
              className="h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="font-semibold text-emerald-900">{item.label}</span>
            <span className="font-bold text-emerald-700">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type BarDatum = {
  label: string;
  value: number;
};

export function BarList({
  data,
  total,
  color = "#176b4d",
  emptyLabel = "No data yet",
}: {
  data: BarDatum[];
  total?: number;
  color?: string;
  emptyLabel?: string;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-emerald-700">{emptyLabel}</p>;
  }

  const maxValue = Math.max(1, ...data.map((item) => item.value));
  const denominator = total && total > 0 ? total : maxValue;

  return (
    <div className="space-y-3">
      {data.map((item) => (
        <div key={item.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="truncate font-semibold text-emerald-900">
              {item.label}
            </span>
            <span className="shrink-0 font-bold text-emerald-700">
              {item.value}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-100">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${(item.value / denominator) * 100}%`,
                backgroundColor: color,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
