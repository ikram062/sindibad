/** Returns a function that says whether `key` may proceed (true) or has used up its attempts (false). */
// shortcut: in-memory and per-process, move to Redis before running more than one server instance
export function rateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const now = Date.now();
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    const allowed = recent.length < max;
    if (allowed) recent.push(now);
    hits.set(key, recent);
    return allowed;
  };
}
