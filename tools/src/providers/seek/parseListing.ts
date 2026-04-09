import { JSDOM } from 'jsdom';
import { z } from 'zod';
import type { SeekJob } from './search.js';

/**
 * Selectors derived from tools/test/fixtures/seek/listing.html (April 2026).
 * SEEK uses data-automation and data-testid attributes which are more stable
 * than class names. If parsing returns 0 jobs, emit a "drift" signal.
 */
const SELECTORS = {
  card: '[data-testid="job-card"]',
  title: '[data-automation="jobTitle"]',
  company: '[data-automation="jobCompany"]',
  jobLink: '[data-automation="job-list-view-job-link"]',
  location: '[data-automation="jobLocation"]',
  snippet: '[data-automation="jobShortDescription"]',
  postedAt: '[data-automation="jobListingDate"]',
} as const;

const BASE_URL = 'https://www.seek.com.au';

/**
 * Parse a SEEK search results page (raw HTML string) into SeekJob records.
 * Pure function — no network or browser calls. Safe to test against a fixture.
 *
 * Returns [] if no cards found (caller should treat as drift).
 */
export function parseListing(html: string): SeekJob[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const cards = Array.from(doc.querySelectorAll(SELECTORS.card));
  const jobs: SeekJob[] = [];

  for (const card of cards) {
    const jobId = card.getAttribute('data-job-id');
    if (!jobId) continue;

    // Title
    const titleEl = card.querySelector(SELECTORS.title);
    const title = titleEl?.textContent?.trim() ?? '';
    if (!title) continue;

    // URL — prefer the job-list-view-job-link (canonical href without query noise)
    const linkEl = card.querySelector(SELECTORS.jobLink);
    const href = linkEl?.getAttribute('href') ?? `/job/${jobId}`;
    const url = href.startsWith('http') ? href : `${BASE_URL}${href.split('?')[0]}`;

    // Company
    const companyEl = card.querySelector(SELECTORS.company);
    const company = companyEl?.textContent?.trim() ?? '';

    // Location — multiple [data-automation="jobLocation"] spans, joined with ", "
    const locationEls = Array.from(card.querySelectorAll(SELECTORS.location));
    const location = locationEls
      .map((el) => el.textContent?.trim() ?? '')
      .filter(Boolean)
      .join(', ') || null;

    // Snippet / short description
    const snippetEl = card.querySelector(SELECTORS.snippet);
    const snippet = snippetEl?.textContent?.trim() || null;

    // Posted-at text (e.g. "1d ago", "3h ago")
    const postedAtEl = card.querySelector(SELECTORS.postedAt);
    const posted_at = postedAtEl?.textContent?.trim() || null;

    jobs.push({
      provider_job_id: jobId,
      title,
      company,
      location,
      url,
      posted_at,
      snippet,
    });
  }

  return jobs;
}

/**
 * Schema guard — verifies the parsed output shape hasn't drifted.
 * Returns { ok: true, jobs } or { ok: false, reason }.
 */
const seekJobSchema = z.object({
  provider_job_id: z.string().min(1),
  title: z.string().min(1),
  company: z.string(),
  location: z.string().nullable(),
  url: z.string().url(),
  posted_at: z.string().nullable(),
  snippet: z.string().nullable(),
});

export type ParseResult =
  | { ok: true; jobs: SeekJob[] }
  | { ok: false; reason: string };

export function parseListing_guarded(html: string): ParseResult {
  const jobs = parseListing(html);

  if (jobs.length === 0) {
    return { ok: false, reason: 'no job cards found — selector drift?' };
  }

  for (const job of jobs) {
    const result = seekJobSchema.safeParse(job);
    if (!result.success) {
      return {
        ok: false,
        reason: `job ${job.provider_job_id} failed schema: ${result.error.message}`,
      };
    }
  }

  return { ok: true, jobs };
}
