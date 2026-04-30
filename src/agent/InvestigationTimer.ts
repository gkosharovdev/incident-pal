const DEFAULT_MAX_DURATION_MS = 10 * 60 * 1000; // 10 minutes

export class InvestigationTimer {
  private readonly startedAt: number;
  readonly maxDurationMs: number;

  constructor(maxDurationMs = DEFAULT_MAX_DURATION_MS) {
    this.maxDurationMs = maxDurationMs;
    this.startedAt = Date.now();
  }

  isExpired(): boolean {
    return this.elapsedMs() >= this.maxDurationMs;
  }

  remainingMs(): number {
    return Math.max(0, this.maxDurationMs - this.elapsedMs());
  }

  elapsedMs(): number {
    return Date.now() - this.startedAt;
  }
}
