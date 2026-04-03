import posthog from 'posthog-js';
import type { PostHogInterface } from 'posthog-js';
import type { MonitoringEvent, EventProperties } from './events';

export function initPostHog(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
  if (!key) return; // no-op in local dev without key configured

  posthog.init(key, {
    api_host: 'https://app.posthog.com',
    session_recording: {
      maskAllInputs: true,
    },
    enable_recording_console_log: true,
    loaded: (ph: PostHogInterface) => {
      if (import.meta.env.DEV) ph.opt_out_capturing();
    },
  });
}

export function posthogTrack<E extends MonitoringEvent>(
  event: E,
  props: EventProperties[E]
): void {
  posthog.capture(event, props as Record<string, unknown>);
}

export function posthogIdentify(
  userId: string,
  traits?: { email?: string; isPremium?: boolean }
): void {
  posthog.identify(userId, traits);
}

export function posthogReset(): void {
  posthog.reset();
}

export function posthogPage(screen: string): void {
  posthog.capture('$pageview', { screen });
}
