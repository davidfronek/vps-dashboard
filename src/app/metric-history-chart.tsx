import type { MetricHistorySample } from "@/lib/metric-history-store";

type MetricHistoryChartProps = {
  label: string;
  metric: "cpuPercent" | "memoryPercent";
  samples: MetricHistorySample[];
};

const Y_TICKS = [100, 75, 50, 25, 0];

function formatTime(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Prague" });
}

export default function MetricHistoryChart({ label, metric, samples }: MetricHistoryChartProps) {
  const firstSample = samples[0];
  const latestSample = samples.at(-1);
  const firstTimestamp = firstSample ? Date.parse(firstSample.collectedAt) : 0;
  const lastTimestamp = latestSample ? Date.parse(latestSample.collectedAt) : 0;
  const timeRange = Math.max(lastTimestamp - firstTimestamp, 1);
  const points = samples.map((sample) => {
    const x = samples.length === 1 ? 1_000 : ((Date.parse(sample.collectedAt) - firstTimestamp) / timeRange) * 1_000;
    const y = 100 - sample[metric];
    return { x, y, value: sample[metric], collectedAt: sample.collectedAt };
  });
  const linePoints = points.map(({ x, y }) => `${x},${y}`).join(" ");
  const areaPoints = points.length > 0 ? `0,100 ${linePoints} 1000,100` : "";
  const latestPoint = points.at(-1);
  const middleSample = samples[Math.floor(samples.length / 2)];

  return (
    <section className="metric-history-chart">
      <div className="metric-history-heading">
        <h3>{label}</h3>
        <strong>{latestPoint ? `${latestPoint.value} %` : "—"}</strong>
      </div>
      {points.length < 2 && <p className="metric-history-empty">Historická data se začnou vykreslovat po dalším měření.</p>}
      <div className="metric-history-plot">
        <div className="metric-history-y" aria-hidden="true">{Y_TICKS.map((tick) => <span key={tick}>{tick} %</span>)}</div>
        <svg className="metric-history-svg" viewBox="0 0 1000 100" preserveAspectRatio="none" role="img" aria-label={`${label} v procentech v čase`}>
          {Y_TICKS.map((tick) => <line className="metric-history-gridline" key={tick} x1="0" x2="1000" y1={100 - tick} y2={100 - tick} />)}
          {points.length > 1 && <polygon className="metric-history-area" points={areaPoints} />}
          {points.length > 1 && <polyline className="metric-history-line" points={linePoints} />}
          {latestPoint && <circle className="metric-history-point" cx={latestPoint.x} cy={latestPoint.y} r="3.5"><title>{formatTime(latestPoint.collectedAt)}: {latestPoint.value} %</title></circle>}
        </svg>
        <div className="metric-history-x" aria-hidden="true">
          <span>{firstSample ? formatTime(firstSample.collectedAt) : "—"}</span>
          <span>{middleSample && middleSample !== firstSample ? formatTime(middleSample.collectedAt) : "—"}</span>
          <span>{latestSample ? formatTime(latestSample.collectedAt) : "—"}</span>
        </div>
      </div>
    </section>
  );
}
