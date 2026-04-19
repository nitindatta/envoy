import { describe, it, expect } from 'vitest';
import { parseRelativeAge, parseListing } from './parseListing.js';

const now = new Date('2026-04-19T12:00:00.000Z');

describe('parseRelativeAge (Indeed format)', () => {
  it('parses days', () => {
    expect(parseRelativeAge('3 days ago', now)).toBe(new Date(now.getTime() - 3 * 86_400_000).toISOString());
  });

  it('parses 1 day ago', () => {
    expect(parseRelativeAge('1 day ago', now)).toBe(new Date(now.getTime() - 86_400_000).toISOString());
  });

  it('parses 30+ days ago (truncates to 30)', () => {
    expect(parseRelativeAge('30+ days ago', now)).toBe(new Date(now.getTime() - 30 * 86_400_000).toISOString());
  });

  it('parses hours', () => {
    expect(parseRelativeAge('2 hours ago', now)).toBe(new Date(now.getTime() - 2 * 3_600_000).toISOString());
  });

  it('handles Just posted', () => {
    expect(parseRelativeAge('Just posted', now)).toBe(now.toISOString());
  });

  it('handles Today', () => {
    expect(parseRelativeAge('Today', now)).toBe(now.toISOString());
  });

  it('returns null for empty string', () => {
    expect(parseRelativeAge('', now)).toBeNull();
  });

  it('returns null for unrecognized format', () => {
    expect(parseRelativeAge('recently', now)).toBeNull();
  });
});

describe('parseListing (Indeed HTML)', () => {
  function makeCard(overrides: {
    jobId?: string;
    title?: string;
    company?: string;
    location?: string;
    snippet?: string;
    salary?: string;
    date?: string;
  } = {}): string {
    const {
      jobId = 'abc123',
      title = 'Senior Python Developer',
      company = 'Acme Corp',
      location = 'Sydney NSW',
      snippet = 'Build backend services.',
      salary = '$130,000 - $150,000 a year',
      date = '2 days ago',
    } = overrides;
    return `
      <div data-jk="${jobId}">
        <h2 class="jobTitle">
          <a href="/viewjob?jk=${jobId}&from=search">
            <span>${title}</span>
          </a>
        </h2>
        <div data-testid="company-name">${company}</div>
        <div data-testid="text-location">${location}</div>
        <div data-testid="attribute_snippet_testid">${salary}</div>
        <div data-testid="job-snippet"><ul><li>${snippet}</li></ul></div>
        <span data-testid="myJobsStateDate">${date}</span>
      </div>
    `;
  }

  it('extracts a basic job card', () => {
    const html = `<html><body>${makeCard()}</body></html>`;
    const jobs = parseListing(html);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.provider_job_id).toBe('abc123');
    expect(jobs[0]!.title).toBe('Senior Python Developer');
    expect(jobs[0]!.company).toBe('Acme Corp');
    expect(jobs[0]!.location).toBe('Sydney NSW');
    expect(jobs[0]!.salary).toBe('$130,000 - $150,000 a year');
    expect(jobs[0]!.bullet_points).toEqual(['Build backend services.']);
  });

  it('builds canonical url from job key', () => {
    const html = `<html><body>${makeCard({ jobId: 'xyz999' })}</body></html>`;
    const jobs = parseListing(html);
    expect(jobs[0]!.url).toBe('https://au.indeed.com/viewjob?jk=xyz999');
  });

  it('parses posted_at from relative date', () => {
    const html = `<html><body>${makeCard({ date: '3 days ago' })}</body></html>`;
    const jobs = parseListing(html);
    expect(jobs[0]!.posted_at).not.toBeNull();
  });

  it('extracts work_arrangement from location', () => {
    const html = `<html><body>${makeCard({ location: 'Melbourne VIC · Hybrid' })}</body></html>`;
    const jobs = parseListing(html);
    expect(jobs[0]!.location).toBe('Melbourne VIC');
    expect(jobs[0]!.work_arrangement).toBe('Hybrid');
  });

  it('deduplicates cards with same data-jk', () => {
    const card = makeCard({ jobId: 'dup1' });
    const html = `<html><body>${card}${card}</body></html>`;
    const jobs = parseListing(html);
    expect(jobs).toHaveLength(1);
  });

  it('returns empty array when no cards present', () => {
    const jobs = parseListing('<html><body><p>No results</p></body></html>');
    expect(jobs).toHaveLength(0);
  });

  it('skips cards without a title', () => {
    const noTitle = `<div data-jk="notitle"><div data-testid="company-name">Corp</div></div>`;
    const jobs = parseListing(`<html><body>${noTitle}</body></html>`);
    expect(jobs).toHaveLength(0);
  });
});
