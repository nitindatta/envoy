import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseDetail } from '../src/providers/seek/parseDetail.js';

const JOB_ID = '91352903';
const JOB_URL = `https://www.seek.com.au/job/${JOB_ID}`;

const fixtureHtml = readFileSync(
  path.resolve(import.meta.dirname, 'fixtures/seek/detail.html'),
  'utf8',
);

describe('parseDetail (SEEK fixture)', () => {
  it('returns ok for a valid detail page', () => {
    const result = parseDetail(fixtureHtml, JOB_ID, JOB_URL);
    expect(result.ok).toBe(true);
  });

  it('extracts correct title', () => {
    const result = parseDetail(fixtureHtml, JOB_ID, JOB_URL);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detail.title).toBe('Data Engineer - Mascot NSW');
  });

  it('extracts correct company', () => {
    const result = parseDetail(fixtureHtml, JOB_ID, JOB_URL);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detail.company).toBe('REMONDIS Australia Pty Ltd');
  });

  it('extracts location via nested anchor', () => {
    const result = parseDetail(fixtureHtml, JOB_ID, JOB_URL);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detail.location).toContain('Mascot');
  });

  it('extracts salary', () => {
    const result = parseDetail(fixtureHtml, JOB_ID, JOB_URL);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detail.salary).toContain('Competitive');
  });

  it('extracts work type', () => {
    const result = parseDetail(fixtureHtml, JOB_ID, JOB_URL);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.detail.work_type).toBe('Full time');
  });

  it('extracts non-empty description', () => {
    const result = parseDetail(fixtureHtml, JOB_ID, JOB_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail.description.length).toBeGreaterThan(100);
    }
  });

  it('sets correct url and provider_job_id', () => {
    const result = parseDetail(fixtureHtml, JOB_ID, JOB_URL);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.detail.provider_job_id).toBe(JOB_ID);
      expect(result.detail.url).toBe(JOB_URL);
    }
  });

  it('returns not-ok for empty HTML', () => {
    const result = parseDetail('<html><body></body></html>', JOB_ID, JOB_URL);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no title found');
  });
});
