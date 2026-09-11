import { describe, expect, it, vi } from 'vitest';
import { randomId } from './random-id';

describe('local HTTP phone previews', () => {
  it('creates valid distinct UUIDs when randomUUID is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      const ids = Array.from({ length: 100 }, () => randomId());
      expect(new Set(ids).size).toBe(100);
      for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
