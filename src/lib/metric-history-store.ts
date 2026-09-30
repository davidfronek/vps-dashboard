import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type MetricHistorySample = {
  collectedAt: string;
  cpuPercent: number;
  memoryPercent: number;
};

const HISTORY_FILE = process.env.NODE_ENV === "production"
  ? "/var/lib/vps-dashboard/metrics/history.json"
  : ".data/metric-history.json";
const SAMPLE_INTERVAL_MS = 60_000;
const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_SAMPLES = HISTORY_WINDOW_MS / SAMPLE_INTERVAL_MS;

let writeQueue = Promise.resolve();

function isMetricHistorySample(value: unknown): value is MetricHistorySample {
  if (!value || typeof value !== "object") return false;
  const sample = value as Partial<MetricHistorySample>;
  return typeof sample.collectedAt === "string"
    && Number.isFinite(Date.parse(sample.collectedAt))
    && typeof sample.cpuPercent === "number"
    && Number.isFinite(sample.cpuPercent)
    && sample.cpuPercent >= 0
    && sample.cpuPercent <= 100
    && typeof sample.memoryPercent === "number"
    && Number.isFinite(sample.memoryPercent)
    && sample.memoryPercent >= 0
    && sample.memoryPercent <= 100;
}

async function readHistory() {
  try {
    const value: unknown = JSON.parse(await readFile(HISTORY_FILE, "utf8"));
    if (!Array.isArray(value)) throw new Error("Metric history must be an array.");
    return value.filter(isMetricHistorySample).slice(-MAX_SAMPLES);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function getMetricHistory() {
  return readHistory();
}

export function recordMetricSample(sample: MetricHistorySample) {
  const operation = writeQueue.then(async () => {
    const history = await readHistory();
    const newestSample = history.at(-1);
    if (newestSample && Date.parse(sample.collectedAt) - Date.parse(newestSample.collectedAt) < SAMPLE_INTERVAL_MS) {
      return history;
    }

    const cutoff = Date.parse(sample.collectedAt) - HISTORY_WINDOW_MS;
    const nextHistory = [...history.filter((entry) => Date.parse(entry.collectedAt) >= cutoff), sample].slice(-MAX_SAMPLES);
    await mkdir(dirname(HISTORY_FILE), { recursive: true });
    const temporaryFile = `${HISTORY_FILE}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporaryFile, `${JSON.stringify(nextHistory)}\n`, { encoding: "utf8", mode: 0o640 });
    await rename(temporaryFile, HISTORY_FILE);
    return nextHistory;
  });
  writeQueue = operation.then(() => undefined, () => undefined);
  return operation;
}
