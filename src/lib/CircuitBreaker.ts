/**
 * CircuitBreaker — Prevents AutoDial infinite loops and network flooding.
 * 
 * Logic: Tracks failures within a sliding time window. If the number of 
 * failures exceeds the threshold, the breaker "trips".
 */

export interface CircuitBreakerConfig {
  /** Max failures allowed before tripping */
  threshold: number;
  /** Time window in milliseconds (e.g., 60000 for 1 minute) */
  windowMs: number;
}

export class CircuitBreaker {
  private failures: number[] = [];
  private config: CircuitBreakerConfig;

  constructor(config: CircuitBreakerConfig = { threshold: 5, windowMs: 60000 }) {
    this.config = config;
  }

  /**
   * Record a failure event.
   * A failure is typically a technical error or a call that ended too quickly.
   */
  recordFailure(): boolean {
    const now = Date.now();
    this.failures.push(now);
    this.cleanup(now);

    const isTripped = this.failures.length >= this.config.threshold;
    if (isTripped) {
      console.error(`[CircuitBreaker] TRIP: ${this.failures.length} failures detected in ${this.config.windowMs}ms.`);
    }
    return isTripped;
  }

  /**
   * Check if the breaker is currently in a tripped state.
   */
  isTripped(): boolean {
    this.cleanup(Date.now());
    return this.failures.length >= this.config.threshold;
  }

  /**
   * Reset the failure count completely.
   */
  reset(): void {
    this.failures = [];
  }

  /**
   * Remove failures that are outside the current time window.
   */
  private cleanup(now: number): void {
    const cutoff = now - this.config.windowMs;
    this.failures = this.failures.filter(timestamp => timestamp > cutoff);
  }
}
