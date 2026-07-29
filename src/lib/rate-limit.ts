// Simple in-memory sliding-window rate limiter.
// NOTE: state lives in this process's memory only — it is per-instance and
// does not coordinate across multiple serverless instances or deployments.

const buckets = new Map<string, number[]>();

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const windowStart = now - windowMs;
  const hits = (buckets.get(key) ?? []).filter((ts) => ts > windowStart);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}
