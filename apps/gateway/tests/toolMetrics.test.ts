import { describe, expect, it } from "vitest";

import { GatewayToolMetrics } from "../src/observability/toolMetrics.js";

describe("GatewayToolMetrics", () => {
  it("exports call counters by server and outcome", () => {
    const metrics = new GatewayToolMetrics();

    metrics.recordCall("woo", "success", 10);
    metrics.recordCall("woo", "success", 20);
    metrics.recordCall("woo", "denied", 2);

    const output = metrics.renderPrometheus();

    expect(output).toContain(
      'urumi_gateway_tool_calls_total{server="woo",outcome="success"} 2',
    );
    expect(output).toContain(
      'urumi_gateway_tool_calls_total{server="woo",outcome="denied"} 1',
    );
  });

  it("exports cumulative latency buckets, sum and count", () => {
    const metrics = new GatewayToolMetrics();

    metrics.recordCall("woo", "success", 10);
    metrics.recordCall("woo", "success", 2000);

    const output = metrics.renderPrometheus();

    expect(output).toContain(
      'urumi_gateway_tool_call_duration_seconds_bucket{server="woo",outcome="success",le="0.025"} 1',
    );
    expect(output).toContain(
      'urumi_gateway_tool_call_duration_seconds_bucket{server="woo",outcome="success",le="2.5"} 2',
    );
    expect(output).toContain(
      'urumi_gateway_tool_call_duration_seconds_bucket{server="woo",outcome="success",le="+Inf"} 2',
    );
    expect(output).toContain(
      'urumi_gateway_tool_call_duration_seconds_sum{server="woo",outcome="success"} 2.01',
    );
    expect(output).toContain(
      'urumi_gateway_tool_call_duration_seconds_count{server="woo",outcome="success"} 2',
    );
  });

  it("bounds invalid server labels to unknown", () => {
    const metrics = new GatewayToolMetrics();

    metrics.recordCall('bad"server\n', "error", 1);

    const output = metrics.renderPrometheus();

    expect(output).toContain(
      'urumi_gateway_tool_calls_total{server="unknown",outcome="error"} 1',
    );
    expect(output).not.toContain('server="bad"server');
  });

  it("renders valid empty metrics before any calls", () => {
    const output = new GatewayToolMetrics().renderPrometheus();

    expect(output).toContain("# TYPE urumi_gateway_tool_calls_total counter");
    expect(output).toContain(
      "# TYPE urumi_gateway_tool_call_duration_seconds histogram",
    );
  });
});
