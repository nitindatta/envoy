import { describe, it, expect } from 'vitest';
import { parseRelativeAge } from './parseListing.js';

describe('parseRelativeAge', () => {
  const now = new Date('2026-04-17T12:00:00.000Z');

  it('parses days', () => {
    const result = parseRelativeAge('23d ago', now);
    expect(result).toBe(new Date(now.getTime() - 23 * 86_400_000).toISOString());
  });

  it('parses hours', () => {
    const result = parseRelativeAge('6h ago', now);
    expect(result).toBe(new Date(now.getTime() - 6 * 3_600_000).toISOString());
  });

  it('parses minutes', () => {
    const result = parseRelativeAge('30m ago', now);
    expect(result).toBe(new Date(now.getTime() - 30 * 60_000).toISOString());
  });

  it('handles just now', () => {
    expect(parseRelativeAge('Just now', now)).toBe(now.toISOString());
  });

  it('handles just posted', () => {
    expect(parseRelativeAge('Just posted', now)).toBe(now.toISOString());
  });

  it('returns null for empty string', () => {
    expect(parseRelativeAge('', now)).toBeNull();
  });

  it('returns null for unrecognized format', () => {
    expect(parseRelativeAge('30+ days ago', now)).toBeNull();
  });
});
