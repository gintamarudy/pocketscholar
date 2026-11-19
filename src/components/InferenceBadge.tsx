// The hybrid-inference badge, shared by the study pack (StudyPanel) and
// the Q&A history (App). Kept in its own module so App can import it
// statically without pulling StudyPanel into the main bundle (StudyPanel
// stays lazy-loaded). The source comes from the SDK's
// `response.inferenceSource`, never from a guess — see lib/ai.ts.
import type { InferenceSourceKind } from '../lib/types';

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function InferenceBadge({ source, modelName, latencyMs }: {
  source: InferenceSourceKind;
  modelName: string;
  latencyMs: number;
}) {
  const label =
    source === 'on_device'
      ? 'On-device (Gemini Nano)'
      : source === 'in_cloud'
        ? 'Cloud (Gemini)'
        : 'Local fallback (extractive)';
  const cls =
    source === 'on_device' ? 'badge badge-device' : source === 'in_cloud' ? 'badge badge-cloud' : 'badge badge-local';
  return (
    <span className={cls} title={modelName}>
      {source === 'on_device' ? '● ' : source === 'in_cloud' ? '☁ ' : '◐ '}
      {label} · {formatLatency(latencyMs)}
    </span>
  );
}
