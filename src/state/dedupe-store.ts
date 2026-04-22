export class DedupeStore {
  private readonly map = new Map<string, number>();

  constructor(private readonly ttlMs: number = 10 * 60 * 1000) {}

  seenRecently(key: string): boolean {
    this.sweep();
    if (this.map.has(key)) return true;
    this.map.set(key, Date.now());
    return false;
  }

  private sweep(): void {
    const cutoff = Date.now() - this.ttlMs;
    for (const [key, ts] of this.map) {
      if (ts < cutoff) this.map.delete(key);
    }
  }
}
