export type AiMetric = {
  stage: 'search' | 'model' | 'validation';
  durationMs: number;
  outcome: 'success' | 'failed' | 'cancelled';
  inputChars?: number;
  attempt?: number;
};

// Bounded, local diagnostics; no prompts, responses, URLs or credentials.
export const aiMetrics: AiMetric[] = [];
export function recordAiMetric(metric: AiMetric) {
  aiMetrics.push(metric);
  if (aiMetrics.length > 100) aiMetrics.shift();
  if (typeof performance !== 'undefined' && typeof performance.measure === 'function') {
    if (performance.getEntriesByName(`cookpilot:ai:${metric.stage}`).length >= 100)
      performance.clearMeasures(`cookpilot:ai:${metric.stage}`);
    performance.measure(`cookpilot:ai:${metric.stage}`, {
      start: performance.now() - metric.durationMs,
      duration: metric.durationMs,
      detail: metric,
    });
  }
}
