import { Injectable } from '@nestjs/common';
import type { CacheStore } from './cache-store';

const MAX_ENTRIES = 5000;

@Injectable()
export class InMemoryCacheStore implements CacheStore {
  private readonly entries = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();

  get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);

    if (!entry) {
      return Promise.resolve(undefined);
    }

    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return Promise.resolve(undefined);
    }

    return Promise.resolve(entry.value as T);
  }

  set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (this.entries.size >= MAX_ENTRIES && !this.entries.has(key)) {
      const [oldestKey] = this.entries.keys();

      if (oldestKey !== undefined) {
        this.entries.delete(oldestKey);
      }
    }

    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }
}
