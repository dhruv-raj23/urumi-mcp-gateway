import type { GatewayAggregator } from "../mcp/aggregator.js";

const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 15_000;

export function configuredHealthCheckIntervalMs(): number {
  const raw = process.env.HEALTH_CHECK_INTERVAL_MS;

  if (raw === undefined) {
    return DEFAULT_HEALTH_CHECK_INTERVAL_MS;
  }

  const intervalMs = Number(raw);

  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1) {
    throw new Error("HEALTH_CHECK_INTERVAL_MS must be a positive integer");
  }

  return intervalMs;
}

export function startHealthLoop(
  aggregator: Pick<GatewayAggregator, "refreshAllServerHealth">,
  intervalMs: number,
): () => void {
  let stopped = false;
  let running = false;

  const run = async (): Promise<void> => {
    if (stopped || running) return;

    running = true;
    try {
      await aggregator.refreshAllServerHealth();
    } catch {
      // Health failures must not crash the gateway process.
    } finally {
      running = false;
    }
  };

  void run();

  const timer = setInterval(() => {
    void run();
  }, intervalMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
