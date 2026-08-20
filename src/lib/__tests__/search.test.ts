import { describe, it, expect } from 'vitest';
import { searchProducts } from '../search';

const products = [
  {
    name: 'Seer Fish',
    nameTamil: 'வஞ்சிரம்',
    aliases: 'vanjaram|vanjiram|neymeen|king fish',
    category: 'Fish',
    description: 'Firm, meaty steaks with very few bones.',
  },
  {
    name: 'Prawn',
    nameTamil: 'இறால்',
    aliases: 'eraal|iraal|shrimp',
    category: 'Prawns',
    description: 'Cleaned and deveined medium prawns.',
  },
  {
    name: 'Mud Crab',
    nameTamil: 'நண்டு',
    aliases: 'nandu|crab',
    category: 'Crab',
    description: 'Live-caught mud crab, heavy with meat.',
  },
];

const top = (query: string) => searchProducts(products, query).matches[0]?.name;

describe('searchProducts', () => {
  it('matches the English name', () => {
    expect(top('seer fish')).toBe('Seer Fish');
  });

  it('matches the Tamil name', () => {
    expect(top('வஞ்சிரம்')).toBe('Seer Fish');
  });

  it('matches a Tanglish alias', () => {
    expect(top('vanjaram')).toBe('Seer Fish');
    expect(top('eraal')).toBe('Prawn');
  });

  it('tolerates typos', () => {
    expect(top('vanjarm')).toBe('Seer Fish');
    expect(top('nandhu')).toBe('Mud Crab');
  });

  it('ranks the better match first', () => {
    // "crab" is Mud Crab's alias and category, only a description word elsewhere.
    expect(top('crab')).toBe('Mud Crab');
  });

  it('falls back to suggestions when nothing matches', () => {
    const { matches, suggestions } = searchProducts(products, 'vanjaram xyzzy');
    expect(matches).toHaveLength(0);
    expect(suggestions[0].name).toBe('Seer Fish');
  });

  it('returns everything for an empty query', () => {
    expect(searchProducts(products, '').matches).toHaveLength(3);
  });
});
