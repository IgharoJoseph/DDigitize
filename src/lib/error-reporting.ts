/**
 * Central place for reporting client-side errors caught by React error
 * boundaries. Production React does not rethrow boundary-caught errors to
 * `window.onerror`, so anything worth logging has to be forwarded here.
 *
 * Swap the console call for your monitoring provider (Sentry, Bugsnag, ...) when
 * one is added.
 */
export function reportAppError(error: unknown, context: Record<string, unknown> = {}) {
  if (typeof window === "undefined") return;

  // Loaders and server functions commonly throw a raw Response; String(it) is
  // the opaque "[object Response]", so pull out the status and URL instead.
  const message =
    error instanceof Response
      ? `Response ${error.status}${error.url ? ` at ${error.url}` : ""}`
      : error instanceof Error
        ? error.message
        : String(error);

  console.error("[app error]", message, {
    route: window.location.pathname,
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
    ...context,
  });
}
