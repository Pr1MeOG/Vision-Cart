import * as Sentry from "@sentry/browser";

const dsn = import.meta.env.VITE_SENTRY_DSN;
const integrations = [];

if (typeof Sentry.browserTracingIntegration === "function") {
  integrations.push(Sentry.browserTracingIntegration());
}

Sentry.init({
  dsn: dsn || undefined,
  enabled: Boolean(dsn),
  environment: import.meta.env.MODE,
  integrations,
  tracesSampleRate: import.meta.env.DEV ? 1.0 : 0.15,
  sendDefaultPii: false,
  beforeSend(event) {
    if (event.user?.email) {
      delete event.user.email;
    }
    return event;
  },
});

export function captureClientError(error, context = {}) {
  if (!dsn) return;
  Sentry.captureException(error, { extra: context });
}
