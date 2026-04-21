import { describe, expect, it } from 'vitest';
import { elementIdSelector, truthyFormValue } from './externalApplyActions.js';

describe('external apply action helpers', () => {
  it('builds a safe data attribute selector for observed element ids', () => {
    expect(elementIdSelector('field_1')).toBe('[data-envoy-apply-id="field_1"]');
    expect(elementIdSelector('field_"x"')).toBe('[data-envoy-apply-id="field_\\"x\\""]');
  });

  it('normalises checkbox truthy values', () => {
    expect(truthyFormValue('yes')).toBe(true);
    expect(truthyFormValue('TRUE')).toBe(true);
    expect(truthyFormValue('checked')).toBe(true);
    expect(truthyFormValue('no')).toBe(false);
    expect(truthyFormValue(null)).toBe(false);
  });
});
