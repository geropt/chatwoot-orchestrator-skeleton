export class DedupeStore {
  private readonly store = new Map<string, number>();

  constructor(private readonly ttlMs = 10 * 60 * 1000) {}

  has(key: string): boolean {
    this.cleanup();
    const expiresAt = this.store.get(key);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  set(key: string): void {
    this.store.set(key, Date.now() + this.ttlMs);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.store.entries()) {
      if (expiresAt <= now) {
        this.store.delete(key);
      }
    }
  }
}
