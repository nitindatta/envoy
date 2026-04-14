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

  it('extracts salary when present', () => {
    const jobs = parseListing(fixtureHtml);
    const withSalary = jobs.filter((j) => j.salary !== null);
    expect(withSalary.length).toBeGreaterThan(0);
    // Salary text should be non-empty
    for (const j of withSalary) {
      expect(j.salary!.length).toBeGreaterThan(0);
    }
  });

  it('extracts work_type when present', () => {
    const jobs = parseListing(fixtureHtml);
    const withType = jobs.filter((j) => j.work_type !== null);
    expect(withType.length).toBeGreaterThan(0);
    // Known work types in fixture
    const types = withType.map((j) => j.work_type);
    expect(types.some((t) => ['Full time', 'Part time', 'Contract/Temp'].includes(t!))).toBe(true);
  });

  it('extracts logo_url when present', () => {
    const jobs = parseListing(fixtureHtml);
    const withLogo = jobs.filter((j) => j.logo_url !== null);
    expect(withLogo.length).toBeGreaterThan(0);
    expect(withLogo[0].logo_url).toMatch(/^https:\/\//);
  });

  it('extracts tags for badge cards', () => {
    const jobs = parseListing(fixtureHtml);
    const withTags = jobs.filter((j) => j.tags.length > 0);
    // Fixture has at least one earlyApplicantAdBadge card
    expect(withTags.length).toBeGreaterThan(0);
  });

  it('all jobs have tags and bullet_points as arrays', () => {
    const jobs = parseListing(fixtureHtml);
    for (const job of jobs) {
      expect(Array.isArray(job.tags)).toBe(true);
      expect(Array.isArray(job.bullet_points)).toBe(true);
    }
  });
});
