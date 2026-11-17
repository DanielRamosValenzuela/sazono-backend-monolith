import { InMemoryCacheStore } from './in-memory-cache.store';

describe('InMemoryCacheStore', () => {
  let store: InMemoryCacheStore;

  beforeEach(() => {
    jest.useFakeTimers();
    store = new InMemoryCacheStore();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns a stored value until its ttl expires', async () => {
    await store.set('key', { a: 1 }, 1000);

    await expect(store.get('key')).resolves.toEqual({ a: 1 });

    jest.advanceTimersByTime(1001);

    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it('deletes a stored value', async () => {
    await store.set('key', 'value', 1000);
    await store.delete('key');

    await expect(store.get('key')).resolves.toBeUndefined();
  });

  it('evicts the oldest entry when the store is full', async () => {
    for (let index = 0; index < 5000; index += 1) {
      await store.set(`key-${index}`, index, 60_000);
    }

    await store.set('extra', 'value', 60_000);

    await expect(store.get('key-0')).resolves.toBeUndefined();
    await expect(store.get('key-1')).resolves.toBe(1);
    await expect(store.get('extra')).resolves.toBe('value');
  });
});
