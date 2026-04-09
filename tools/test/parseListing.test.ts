import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseListing, parseListing_guarded } from '../src/providers/seek/parseListing.js';

const fixtureHtml = readFileSync(
  path.resolve(import.meta.dirname, 'fixtures/seek/listing.html'),
  'utf8',
);

describe('parseListing (SEEK fixture)', () => {
  it('returns at least one job from the fixture', () => {
    const jobs = parseListing(fixtureHtml);
    expect(jobs.length).toBeGreaterThan(0);
  });

  it('every job has required fields', () => {
    const jobs = parseListing(fixtureHtml);
    for (const job of jobs) {
      expect(job.provider_job_id).toBeTruthy();
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\/www\.seek\.com\.au\/job\//);
    }
  });

  it('first job matches expected fixture data', () => {
    const jobs = parseListing(fixtureHtml);
    const first = jobs[0];
    expect(first).toBeDefined();
    // Fixture: first card is job-id 91233258 "Data Engineer" at Fremantle Dockers
    expect(first!.provider_job_id).toBe('91233258');
    expect(first!.title).toBe('Data Engineer');
    expect(first!.company).toBe('Fremantle Dockers');
    expect(first!.url).toBe('https://www.seek.com.au/job/91233258');
    expect(first!.location).toContain('Perth WA');
    expect(first!.snippet).toBeTruthy();
  });

  it('extracts location for all jobs that have one', () => {
    const jobs = parseListing(fixtureHtml);
    const withLocation = jobs.filter((j) => j.location !== null);
    expect(withLocation.length).toBeGreaterThan(0);
  });

  it('extracts snippet for most jobs', () => {
    const jobs = parseListing(fixtureHtml);
    const withSnippet = jobs.filter((j) => j.snippet !== null);
    expect(withSnippet.length).toBeGreaterThan(0);
  });

  it('schema guard passes on real fixture', () => {
    const result = parseListing_guarded(fixtureHtml);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.jobs.length).toBeGreaterThan(0);
    }
  });

  it('schema guard fails on empty HTML', () => {
    const result = parseListing_guarded('<html><body></body></html>');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('no job cards found');
    }
  });
});
