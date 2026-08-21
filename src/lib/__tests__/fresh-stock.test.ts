import { describe, it, expect } from 'vitest';
import { pickFreshStock } from '../products';

const p = (
  name: string,
  o: Partial<{ availability: boolean; quantity: number; stockKg: number; restockedAt: string | null; createdAt: string }> = {}
) => ({
  name,
  availability: true,
  quantity: 5,
  stockKg: 5,
  restockedAt: null as string | null,
  createdAt: '2020-01-01T00:00:00.000Z',
  ...o,
});

describe('pickFreshStock', () => {
  it('puts a recent restock ahead of an older one', () => {
    const out = pickFreshStock([
      p('old', { restockedAt: '2024-01-01T00:00:00.000Z' }),
      p('new', { restockedAt: '2026-08-01T00:00:00.000Z' }),
    ]);
    expect(out.map((x) => x.name)).toEqual(['new', 'old']);
  });

  it('falls back to createdAt when never restocked', () => {
    const out = pickFreshStock([
      p('added-first', { createdAt: '2024-01-01T00:00:00.000Z' }),
      p('added-later', { createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(out[0].name).toBe('added-later');
  });

  it('hides anything a shopper cannot actually buy', () => {
    const out = pickFreshStock([
      p('unavailable', { availability: false }),
      p('no-stock', { quantity: 0, stockKg: 0 }),
      p('buyable'),
    ]);
    expect(out.map((x) => x.name)).toEqual(['buyable']);
  });

  it('respects the limit', () => {
    expect(pickFreshStock([p('a'), p('b'), p('c')], 2)).toHaveLength(2);
  });
});
