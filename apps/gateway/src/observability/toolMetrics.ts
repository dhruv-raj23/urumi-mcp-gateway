import type { AuditOutcome } from "../db/models.js";

const SERVER_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,23}$/;

const LATENCY_BUCKETS_SECONDS = [
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10,
  30,
] as const;

interface ToolMetricSeries {
  server: string;
  outcome: AuditOutcome;
  calls: number;
  durationSumSeconds: number;
  bucketCounts: number[];
}

function escapeLabel(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/"/g, '\\"');
}

function formatNumber(value: number): string {
  return String(Number(value.toFixed(9)));
}

/**
 * Dependency-free, process-local Prometheus metrics for gateway tool calls.
 *
 * Labels deliberately exclude users, API keys, tool names and arguments.
 * Metrics reset on process restart and are not aggregated across replicas.
 */
export class GatewayToolMetrics {
  private readonly series = new Map<string, ToolMetricSeries>();

  recordCall(
    serverSlug: string,
    outcome: AuditOutcome,
    durationMs: number,
  ): void {
    const server = SERVER_SLUG_PATTERN.test(serverSlug)
      ? serverSlug
      : "unknown";
    const key = `${server}\u0000${outcome}`;

    let metric = this.series.get(key);

    if (!metric) {
      metric = {
        server,
        outcome,
        calls: 0,
        durationSumSeconds: 0,
        bucketCounts: LATENCY_BUCKETS_SECONDS.map(() => 0),
      };
      this.series.set(key, metric);
    }

    const safeDurationMs = Number.isFinite(durationMs)
      ? Math.max(0, durationMs)
      : 0;
    const durationSeconds = safeDurationMs / 1000;

    metric.calls += 1;
    metric.durationSumSeconds += durationSeconds;

    LATENCY_BUCKETS_SECONDS.forEach((bound, index) => {
      if (durationSeconds <= bound) {
        metric.bucketCounts[index] = (metric.bucketCounts[index] ?? 0) + 1;
      }
    });
  }

  renderPrometheus(): string {
    const lines: string[] = [
      "# HELP urumi_gateway_tool_calls_total Total gateway tool calls by server and outcome.",
      "# TYPE urumi_gateway_tool_calls_total counter",
    ];

    const metrics = [...this.series.values()].sort(
      (a, b) =>
        a.server.localeCompare(b.server) ||
        a.outcome.localeCompare(b.outcome),
    );

    for (const metric of metrics) {
      const labels =
        `server="${escapeLabel(metric.server)}",outcome="${metric.outcome}"`;

      lines.push(
        `urumi_gateway_tool_calls_total{${labels}} ${metric.calls}`,
      );
    }

    lines.push(
      "# HELP urumi_gateway_tool_call_duration_seconds Duration of gateway tool calls in seconds.",
      "# TYPE urumi_gateway_tool_call_duration_seconds histogram",
    );

    for (const metric of metrics) {
      const labels =
        `server="${escapeLabel(metric.server)}",outcome="${metric.outcome}"`;

      LATENCY_BUCKETS_SECONDS.forEach((bound, index) => {
        lines.push(
          `urumi_gateway_tool_call_duration_seconds_bucket{${labels},le="${bound}"} ${metric.bucketCounts[index] ?? 0}`,
        );
      });

      lines.push(
        `urumi_gateway_tool_call_duration_seconds_bucket{${labels},le="+Inf"} ${metric.calls}`,
        `urumi_gateway_tool_call_duration_seconds_sum{${labels}} ${formatNumber(metric.durationSumSeconds)}`,
        `urumi_gateway_tool_call_duration_seconds_count{${labels}} ${metric.calls}`,
      );
    }

    return `${lines.join("\n")}\n`;
  }
}
