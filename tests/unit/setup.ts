import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import { beforeEach } from 'vitest';
import { db } from '../../src/storage/db';
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const values = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  },
});
beforeEach(async () => {
  values.clear();
  await db.transaction('rw', db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
});
