"use client";

import { useRef, useState } from "react";
import { formatNumber } from "../weather-support";

export type ChartPoint = { label: string; value: number | null };

export type ChartSeries = {
  id: string;
  label: string;
  /** CSS colour, e.g., "var(--chart-rain)". Chart marks use it; text labels do not. */
  color: string;
  type: "bar" | "line";
  points: ChartPoint[];
};

type TimeChartProps = {
  title: string;
  unit: string;
  /** All series share one unit and one y-axis (never dual-axis). */
  series: ChartSeries[];
  decimals?: number;
};

const W = 640;
const H = 190;
const PAD_LEFT = 46;
const PAD_RIGHT = 14;
const PAD_TOP = 10;
const PAD_BOTTOM = 24;
const INNER_W = W - PAD_LEFT - PAD_RIGHT;
const INNER_H = H - PAD_TOP - PAD_BOTTOM;

function niceTicks(min: number, max: number, count = 4): number[] {
  let low = min;
  let high = max;
  if (low === high) {
    low -= 1;
    high += 1;
  }
  const rawStep = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step =
    (normalized >= 7.5 ? 10 : normalized >= 3.5 ? 5 : normalized >= 1.5 ? 2 : 1) * magnitude;
  const start = Math.ceil(low / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= high + 1e-9; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }
  return ticks;
}

/** Bar with a 4px-rounded data end and a square baseline. */
function barPath(x: number, width: number, yTop: number, yBase: number): string {
  const radius = Math.min(4, width / 2, Math.abs(yBase - yTop));
  return [
    `M ${x} ${yBase}`,
    `L ${x} ${yTop + radius}`,
    `Q ${x} ${yTop} ${x + radius} ${yTop}`,
    `L ${x + width - radius} ${yTop}`,
    `Q ${x + width} ${yTop} ${x + width} ${yTop + radius}`,
    `L ${x + width} ${yBase}`,
    "Z",
  ].join(" ");
}

export function TimeChart({ title, unit, series, decimals = 1 }: TimeChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const labels = series[0]?.points.map((point) => point.label) ?? [];
  const pointCount = labels.length;
  const hasBars = series.some((entry) => entry.type === "bar");
  const allValues = series.flatMap((entry) =>
    entry.points.map((point) => point.value).filter((value): value is number => value !== null),
  );

  if (pointCount === 0 || allValues.length === 0) {
    return (
      <div className="chart-block">
        <p className="chart-title">{title}</p>
        <p className="chart-empty">Nothing to chart yet.</p>
      </div>
    );
  }

  let dataMin = Math.min(...allValues);
  const dataMax = Math.max(...allValues);
  if (hasBars) {
    dataMin = Math.min(dataMin, 0);
  }
  const ticks = niceTicks(dataMin, dataMax);
  const domainMin = Math.min(dataMin, ticks[0] ?? dataMin);
  const domainMax = Math.max(dataMax, ticks[ticks.length - 1] ?? dataMax);
  const yAt = (value: number): number =>
    PAD_TOP + (1 - (value - domainMin) / (domainMax - domainMin)) * INNER_H;
  const xAt = (index: number): number => PAD_LEFT + ((index + 0.5) / pointCount) * INNER_W;

  const slotWidth = INNER_W / pointCount;
  const barWidth = Math.min(24, slotWidth * 0.72);
  const baselineY = yAt(Math.max(0, domainMin));

  // ~5 x-axis labels, always including first and last.
  const labelStep = Math.max(1, Math.ceil(pointCount / 5));
  const xLabelIndices = new Set<number>([0, pointCount - 1]);
  for (let index = labelStep; index < pointCount - 1; index += labelStep) {
    if (index <= pointCount - 1 - labelStep / 2) {
      xLabelIndices.add(index);
    }
  }

  const setIndexFromPointer = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) {
      return;
    }
    const viewX = ((clientX - rect.left) / rect.width) * W;
    const index = Math.floor(((viewX - PAD_LEFT) / INNER_W) * pointCount);
    setActiveIndex(Math.max(0, Math.min(pointCount - 1, index)));
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      setActiveIndex((current) =>
        Math.max(0, Math.min(pointCount - 1, (current ?? pointCount - 1) + delta)),
      );
    } else if (event.key === "Escape") {
      setActiveIndex(null);
    }
  };

  const tooltipLeft =
    activeIndex === null ? 0 : Math.max(12, Math.min(88, (xAt(activeIndex) / W) * 100));

  return (
    <div className="chart-block">
      <p className="chart-title">{title}</p>
      {series.length > 1 ? (
        <div className="chart-legend">
          {series.map((entry) => (
            <span className="chart-legend-item" key={entry.id}>
              <span
                aria-hidden="true"
                className="chart-legend-swatch"
                style={{ background: entry.color, height: entry.type === "line" ? 2 : 8 }}
              />
              {entry.label}
            </span>
          ))}
        </div>
      ) : null}

      <div
        aria-label={`${title}, in ${unit}. Use the arrow keys to step through values; exact values are in the table below.`}
        className="chart-wrap"
        onBlur={() => setActiveIndex(null)}
        onFocus={() => setActiveIndex((current) => current ?? pointCount - 1)}
        onKeyDown={onKeyDown}
        onPointerLeave={() => setActiveIndex(null)}
        onPointerMove={(event) => setIndexFromPointer(event.clientX)}
        ref={wrapRef}
        role="img"
        tabIndex={0}
      >
        <svg aria-hidden="true" preserveAspectRatio="xMidYMid meet" viewBox={`0 0 ${W} ${H}`}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                shapeRendering="crispEdges"
                stroke="var(--loam-border)"
                strokeWidth="1"
                x1={PAD_LEFT}
                x2={W - PAD_RIGHT}
                y1={yAt(tick)}
                y2={yAt(tick)}
              />
              <text
                fill="var(--loam-muted)"
                fontSize="10"
                style={{ fontVariantNumeric: "tabular-nums" }}
                textAnchor="end"
                x={PAD_LEFT - 6}
                y={yAt(tick) + 3}
              >
                {formatNumber(tick, tick % 1 === 0 ? 0 : 1)}
              </text>
            </g>
          ))}

          {[...xLabelIndices].sort((a, b) => a - b).map((index) => (
            <text
              fill="var(--loam-muted)"
              fontSize="10"
              key={index}
              textAnchor="middle"
              x={xAt(index)}
              y={H - 6}
            >
              {labels[index]}
            </text>
          ))}

          {activeIndex !== null ? (
            <line
              stroke="var(--loam-muted)"
              strokeOpacity="0.55"
              strokeWidth="1"
              x1={xAt(activeIndex)}
              x2={xAt(activeIndex)}
              y1={PAD_TOP}
              y2={H - PAD_BOTTOM}
            />
          ) : null}

          {series
            .filter((entry) => entry.type === "bar")
            .map((entry) => (
              <g fill={entry.color} key={entry.id}>
                {entry.points.map((point, index) => {
                  if (point.value === null) {
                    return null;
                  }
                  const top = yAt(Math.max(0, point.value));
                  return (
                    <path
                      d={barPath(xAt(index) - barWidth / 2, barWidth, top, baselineY)}
                      fillOpacity={activeIndex === index ? 1 : 0.85}
                      key={point.label}
                    />
                  );
                })}
              </g>
            ))}

          {series
            .filter((entry) => entry.type === "line")
            .map((entry) => {
              // Split into continuous segments so nulls read as gaps.
              const segments: Array<Array<[number, number]>> = [];
              let current: Array<[number, number]> = [];
              entry.points.forEach((point, index) => {
                if (point.value === null) {
                  if (current.length > 0) {
                    segments.push(current);
                    current = [];
                  }
                } else {
                  current.push([xAt(index), yAt(point.value)]);
                }
              });
              if (current.length > 0) {
                segments.push(current);
              }
              const lastSegment = segments[segments.length - 1];
              const endPoint = lastSegment?.[lastSegment.length - 1];
              return (
                <g key={entry.id}>
                  {segments.map((segment, segmentIndex) => (
                    <path
                      d={segment
                        .map(([x, y], pointIndex) => `${pointIndex === 0 ? "M" : "L"} ${x} ${y}`)
                        .join(" ")}
                      fill="none"
                      key={segmentIndex}
                      stroke={entry.color}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                    />
                  ))}
                  {endPoint ? (
                    <circle
                      cx={endPoint[0]}
                      cy={endPoint[1]}
                      fill={entry.color}
                      r="4.5"
                      stroke="var(--loam-panel)"
                      strokeWidth="2"
                    />
                  ) : null}
                </g>
              );
            })}
        </svg>

        {activeIndex !== null ? (
          <div className="chart-tooltip" style={{ left: `${tooltipLeft}%` }}>
            <span className="chart-tooltip-label">{labels[activeIndex]}</span>
            {series.map((entry) => {
              const value = entry.points[activeIndex]?.value ?? null;
              return (
                <span className="chart-tooltip-row" key={entry.id}>
                  <span
                    aria-hidden="true"
                    className="chart-tooltip-key"
                    style={{ background: entry.color }}
                  />
                  <strong>{value === null ? "—" : `${formatNumber(value, decimals)} ${unit}`}</strong>
                  <span className="chart-tooltip-series">{entry.label}</span>
                </span>
              );
            })}
          </div>
        ) : null}
      </div>

      <details className="chart-table">
        <summary>View as table</summary>
        <div className="chart-table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Date</th>
                {series.map((entry) => (
                  <th key={entry.id} scope="col">
                    {entry.label} ({unit})
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label, index) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  {series.map((entry) => {
                    const value = entry.points[index]?.value ?? null;
                    return <td key={entry.id}>{value === null ? "—" : formatNumber(value, decimals)}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
