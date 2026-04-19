import { JSDOM } from 'jsdom';
import { type ProviderJob, providerJobSchema } from '../types.js';

/**
 * Selectors derived from au.indeed.com search results (April 2026).
 * Indeed uses data-jk on the card and data-testid attributes on sub-elements.
 * If parsing returns 0 jobs, emit a "drift" signal.
 */
const SELECTORS = {
  card: '[data-jk]',
  titleLink: 'h2.jobTitle a, [data-testid="job-title"] a',
  titleSpan: 'h2.jobTitle a span, [data-testid="job-title"] a span',
  company: '[data-testid="company-name"]',
  location: '[data-testid="text-location"]',
  snippet: '[data-testid="job-snippet"]',
  salary: '[data-testid="attribute_snippet_testid"], .salary-snippet-container .salary-snippet',
  date: '[data-testid="myJobsStateDate"], .date',
} as const;

const ARRANGEMENT_KEYWORDS = new Set([
  'hybrid', 'remote', 'work from home', 'wfh', 'on-site', 'onsite',
]);

const BASE_URL = 'https://au.indeed.com';

/**
 * Converts Indeed relative age strings to ISO 8601 timestamps.
 * Indeed formats: "Just posted", "Today", "1 day ago", "3 days ago", "30+ days ago"
 */
export function parseRelativeAge(text: string, now: Date = new Date()): string | null {
  if (!text) return null;
  const t = text.trim().toLowerCase().replace(/\s+/g, ' ');

  if (/just posted|just now|today/.test(t)) return now.toISOString();

  // "1 day ago", "2 days ago", "30+ days ago"
  const dayMatch = t.match(/^(\d+)\+?\s+days?\s+ago$/);
  if (dayMatch) {
    const n = parseInt(dayMatch[1]!, 10);
    return new Date(now.getTime() - n * 86_400_000).toISOString();
  }

  // "1 hour ago", "2 hours ago"
  const hourMatch = t.match(/^(\d+)\+?\s+hours?\s+ago$/);
  if (hourMatch) {
    const n = parseInt(hourMatch[1]!, 10);
    return new Date(now.getTime() - n * 3_600_000).toISOString();
  }

  return null;
}

/**
 * Parse an Indeed search results page (raw HTML) into ProviderJob records.
 * Pure function — no network or browser calls.
 */
export function parseListing(html: string): ProviderJob[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const cards = Array.from(doc.querySelectorAll(SELECTORS.card));
  const jobs: ProviderJob[] = [];
  const seen = new Set<string>();

  for (const card of cards) {
    const jobId = card.getAttribute('data-jk');
    if (!jobId || seen.has(jobId)) continue;
    seen.add(jobId);

    // Title — try span inside link first (cleaner text), fall back to full link text
    const titleSpanEl = card.querySelector(SELECTORS.titleSpan);
    const titleLinkEl = card.querySelector(SELECTORS.titleLink);
    const title = titleSpanEl?.textContent?.trim() ?? titleLinkEl?.textContent?.trim() ?? '';
    if (!title) continue;

    // URL — always use the canonical viewjob URL with just the job key, stripping tracking params
    const url = `${BASE_URL}/viewjob?jk=${jobId}`;

    // Company
    const company = card.querySelector(SELECTORS.company)?.textContent?.trim() ?? '';

    // Location — split location text to separate work arrangement keywords
    const locationText = card.querySelector(SELECTORS.location)?.textContent?.trim() ?? '';
    const locationParts: string[] = [];
    let work_arrangement: string | null = null;
    for (const part of locationText.split(/[·•,]/)) {
      const p = part.trim();
      if (!p) continue;
      if (ARRANGEMENT_KEYWORDS.has(p.toLowerCase())) {
        work_arrangement = work_arrangement ?? p;
      } else {
        locationParts.push(p);
      }
    }
    const location = locationParts.join(', ') || null;

    // Snippet + bullet points
    const snippetEl = card.querySelector(SELECTORS.snippet);
    const snippet = snippetEl?.textContent?.trim() || null;
    const bulletEls = snippetEl ? Array.from(snippetEl.querySelectorAll('li')) : [];
    const bullet_points = bulletEls
      .map((li) => li.textContent?.trim() ?? '')
      .filter(Boolean);

    // Salary
    const salaryEl = card.querySelector(SELECTORS.salary);
    const salary = salaryEl?.textContent?.trim() || null;

    // Posted-at
    const dateEl = card.querySelector(SELECTORS.date);
    const posted_at = parseRelativeAge(dateEl?.textContent?.trim() ?? '');

    jobs.push({
      provider_job_id: jobId,
      title,
      company,
      location,
      url,
      posted_at,
      snippet,
      salary,
      work_type: null,
      work_arrangement,
      tags: [],
      logo_url: null,
      bullet_points,
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
    return { ok: false, reason: 'no job cards found — selector drift?' };
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
