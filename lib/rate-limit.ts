import { RelayError } from "@/lib/errors";

const windows = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const LIMIT = 120;

export function checkAgentRateLimit(key: string, currentTime = Date.now()) {
  const current = windows.get(key);
  if (!current || current.resetAt <= currentTime) {
    windows.set(key, { count: 1, resetAt: currentTime + WINDOW_MS });
    return;
  }
  current.count += 1;
  if (current.count > LIMIT) throw new RelayError("RATE_LIMITED", "Relay agent request limit exceeded.", undefined, 429);
}

export function resetRateLimitsForTests() {
  windows.clear();
}
