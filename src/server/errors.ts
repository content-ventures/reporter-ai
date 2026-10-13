export class FlowError extends Error {
  code: string; status: number; retryable: boolean; waitSeconds: number;
  constructor(code: string, status = 422, retryable = false, waitSeconds = 0) {
    super(code); this.code = code; this.status = status; this.retryable = retryable; this.waitSeconds = waitSeconds;
  }
}
export function safeCode(error: unknown): string {
  if (error instanceof FlowError) return error.code;
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  if (["40001","42501","23514","22023","55000","ECONNREFUSED","ENOENT"].includes(code)) return code;
  if (error instanceof Error && ["LOCAL_MODE_DISABLED","GROQ_KEY_MISSING","OPENAI_KEY_MISSING","ANTHROPIC_KEY_MISSING","DATABASE_CONFIGURATION"].includes(error.message)) return error.message;
  return "INTERNAL_ERROR";
}

/** Quota waits are not malformed-output attempts; still bound the total waiting window. */
export function editorialRetryPolicy(error: unknown, attempts: number, createdAt: string, interrupted = false, now = Date.now()) {
  const limited = error instanceof FlowError && /^(GROQ|OPENAI|ANTHROPIC)_RATE_LIMIT$/.test(error.code);
  const nextAttempts = limited ? Math.max(0, attempts - 1) : attempts;
  const age = now - Date.parse(createdAt);
  const withinWindow = Number.isFinite(age) && age >= 0 && age < 5 * 60 * 1000;
  const delayMs = Math.max(limited ? 30 : 5, error instanceof FlowError ? error.waitSeconds : 5) * 1000;
  const maxAttempts = interrupted ? 8 : 3;
  return { attempts: nextAttempts, retry: (error instanceof FlowError && error.retryable || interrupted) && nextAttempts < maxAttempts && withinWindow
    && age + delayMs < 5 * 60 * 1000, delayMs };
}
export function logEvent(component: string, message: string, attributes: { request_id?: string; job_id?: string; generation_id?: string; error_code?: string; duration_ms?: number } = {}) {
  if (!/^[a-z_-]{1,40}$/.test(component) || !/^[a-z_]{1,80}$/.test(message)) return;
  // Only bounded, allowlisted operational metadata; never serialize Error objects,
  // provider responses, prompts, paths, credentials, filenames or editorial text.
  const clean = Object.fromEntries(Object.entries(attributes).filter(([key, value]) => {
    if (key === "duration_ms") return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
    if (key === "error_code") return typeof value === "string" && /^(?:[A-Z][A-Z0-9_]{0,63}|[0-9]{5})$/.test(value);
    return ["request_id","job_id","generation_id"].includes(key) && typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }));
  // Diagnostics are lossy when their output stream is saturated. Do not queue
  // unbounded records or block an accepted editorial transaction.
  try {
    if (process.stdout.writableLength > 65536 || process.stdout.destroyed) return;
    process.stdout.write(JSON.stringify({
    timestamp: new Date().toISOString(), level: clean.error_code ? "error" : "info",
    environment: "local", service: "reporter-ai", component, message, schema_version: 1, ...clean,
    }) + "\n");
  } catch { /* Diagnostic failure must not replace a business transaction. */ }
}
