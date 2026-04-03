// Error capture is delegated to PostHog — no Sentry dependency.
import posthog from 'posthog-js';

// Kept as a no-op so main.tsx call site compiles without changes.
export function initSentry(): void {}

export function sentryCapture(err: Error, ctx?: Record<string, unknown>): void {
  posthog.captureException(err, ctx);
}

export function sentryIdentify(_userId: string, _email?: string): void {
  // Identity is managed by posthog.identify() in posthog.ts
}

export function sentryReset(): void {
  // Reset is managed by posthog.reset() in posthog.ts
}
