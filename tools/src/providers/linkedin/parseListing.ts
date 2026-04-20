import { JSDOM } from 'jsdom';
import { type ProviderJob, providerJobSchema } from '../types.js';


const SELECTORS = {
  card: 'div[data-job-id]',
  titleLink: 'a.job-card-container__link',
  company: '.artdeco-entity-lockup__subtitle span',
  location: '.job-card-container__metadata-wrapper li span',
  dateTime: 'time[datetime]',
  logo: '.job-card-list__logo img',
} as const;

const BASE_URL = 'https://www.linkedin.com';

/**
 * Parse a LinkedIn job search results page into ProviderJob records.
 * Pure function — no network or browser calls.
 */
export function parseListing(html: string): ProviderJob[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const cards = Array.from(doc.querySelectorAll(SELECTORS.card));
  const jobs: ProviderJob[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    // Job ID — directly from data-job-id attribute
    const jobId = card.getAttribute('data-job-id');
    if (!jobId || seen.has(jobId)) continue;
    seen.add(jobId);

    // Title — from aria-label on the link (most reliable, avoids nested spans)
    const linkEl = card.querySelector(SELECTORS.titleLink);
    const title = linkEl?.getAttribute('aria-label')?.trim() ?? '';
    if (!title) continue;

    // Canonical URL
    const url = `${BASE_URL}/jobs/view/${jobId}`;

    // Company
    const company = card.querySelector(SELECTORS.company)?.textContent?.trim() ?? '';

    // Location
    const locationText = card.querySelector(SELECTORS.location)?.textContent?.trim() ?? '';
    const location = locationText || null;

    // posted_at — ISO date from datetime attribute
    const timeEl = card.querySelector(SELECTORS.dateTime);
    const datetimeAttr = timeEl?.getAttribute('datetime');
    const posted_at = datetimeAttr ? new Date(datetimeAttr).toISOString() : null;

    // Logo — img src inside the logo container
    const logoEl = card.querySelector(SELECTORS.logo);
    const logo_url = logoEl?.getAttribute('src') ?? null;

    jobs.push({
      provider_job_id: jobId,
      title,
      company,
      location,
      url,
      posted_at,
      snippet: null,
      salary: null,
      work_type: null,
      work_arrangement: null,
      tags: [],
      logo_url,
      bullet_points: [],
    });
  }

  return jobs;
}

export type ParseResult =
  | { ok: true; jobs: ProviderJob[] }
  | { ok: false; reason: string };

export function parseListing_guarded(html: string): ParseResult {
  const jobs = parseListing(html);

  if (jobs.length === 0) {
    return { ok: false, reason: 'no job cards found — selector drift or login required?' };
  }

  for (const job of jobs) {
    const result = providerJobSchema.safeParse(job);
    if (!result.success) {
      return {
        ok: false,
        reason: `job ${job.provider_job_id} failed schema: ${result.error.message}`,
      };
    }
  }

  return { ok: true, jobs };
}
