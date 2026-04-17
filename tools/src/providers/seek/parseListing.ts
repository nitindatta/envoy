import { JSDOM } from 'jsdom';
import { type ProviderJob, providerJobSchema } from '../types.js';

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
  salary: '[data-automation="jobSalary"]',
  logoImg: '[data-automation="company-logo"] img',
  // Multiple badge types: early applicant, profile match ("Strong applicant"), etc.
  badges: [
    '[data-automation="earlyApplicantAdBadge"]',
    '[data-automation="jobBadge"]',
    '[data-automation="matchBadge"]',
    '[data-automation="personalBadge"]',
  ],
} as const;

// Work arrangement keywords that may appear as location span text
const ARRANGEMENT_KEYWORDS = new Set([
  'hybrid', 'remote', 'on-site', 'onsite', 'work from home', 'wfh',
]);

const BASE_URL = 'https://www.seek.com.au';

/**
 * Converts SEEK relative age strings (e.g. "1d ago", "3h ago", "30m ago")
 * to ISO 8601 timestamps. Returns null for unrecognised formats.
 */
export function parseRelativeAge(text: string, now: Date = new Date()): string | null {
  if (!text) return null;
  const t = text.trim().toLowerCase();
  const match = t.match(/^(\d+)(d|h|m)\s+ago$/);
  if (match) {
    const n = parseInt(match[1]!, 10);
    const unit = match[2]!; // regex group 2 is always present when match is truthy
    const ms = unit === 'd' ? n * 86_400_000 : unit === 'h' ? n * 3_600_000 : n * 60_000;
    return new Date(now.getTime() - ms).toISOString();
  }
  // "just now", "just posted", "today"
  if (/just|today/.test(t)) return now.toISOString();
  return null;
}

/**
 * Parse a SEEK search results page (raw HTML string) into ProviderJob records.
 * Pure function — no network or browser calls. Safe to test against a fixture.
 *
 * Returns [] if no cards found (caller should treat as drift).
 */
export function parseListing(html: string): ProviderJob[] {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const cards = Array.from(doc.querySelectorAll(SELECTORS.card));
  const jobs: ProviderJob[] = [];

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

    // Location — split jobLocation spans into actual location text vs work arrangement
    // e.g. "Sydney NSW", "(Hybrid)" → location="Sydney NSW", work_arrangement="Hybrid"
    const locationEls = Array.from(card.querySelectorAll(SELECTORS.location));
    const locationParts: string[] = [];
    let work_arrangement: string | null = null;
    for (const el of locationEls) {
      const text = el.textContent?.trim() ?? '';
      if (!text) continue;
      const normalized = text.replace(/^\(|\)$/g, '').trim().toLowerCase();
      if (ARRANGEMENT_KEYWORDS.has(normalized)) {
        work_arrangement = work_arrangement ?? text.replace(/^\(|\)$/g, '').trim();
      } else {
        locationParts.push(text);
      }
    }
    const location = locationParts.join(', ') || null;

    // Snippet / short description (plain text for summary)
    const snippetEl = card.querySelector(SELECTORS.snippet);
    const snippet = snippetEl?.textContent?.trim() || null;

    // Bullet points — extracted from <li> elements inside shortDescription
    // Premium SEEK ads often format the snippet as a bullet list
    const bulletEls = snippetEl ? Array.from(snippetEl.querySelectorAll('li')) : [];
    const bullet_points = bulletEls
      .map((li) => li.textContent?.trim() ?? '')
      .filter(Boolean);

    // Posted-at: convert relative age string to ISO 8601 timestamp
    const postedAtEl = card.querySelector(SELECTORS.postedAt);
    const posted_at = parseRelativeAge(postedAtEl?.textContent?.trim() ?? '');

    // Salary (e.g. "$200k - $220k p.a.", "Up to $1000/day")
    const salaryEl = card.querySelector(SELECTORS.salary);
    const salary = salaryEl?.textContent?.trim() || null;

    // Work type — from <p>This is a X job</p> pattern inside the card
    const workTypeP = Array.from(card.querySelectorAll('p')).find((p) =>
      /This is a .+ job/i.test(p.textContent ?? ''),
    );
    const workTypeMatch = workTypeP?.textContent?.match(/This is a (.+) job/i);
    const work_type = workTypeMatch?.[1]?.trim() ?? null;

    // Tags / badges (match label, early applicant, etc.)
    const tags = SELECTORS.badges
      .flatMap((sel) => Array.from(card.querySelectorAll(sel)))
      .map((el) => el.textContent?.trim() ?? '')
      .filter(Boolean);

    // Company logo URL
    const logoEl = card.querySelector(SELECTORS.logoImg) as (Element & { src?: string }) | null;
    const logo_url = logoEl?.getAttribute('src') || null;

    jobs.push({
      provider_job_id: jobId,
      title,
      company,
      location,
      url,
      posted_at,
      snippet,
      salary,
      work_type,
      work_arrangement,
      tags,
      logo_url,
      bullet_points,
    });
  }

  return jobs;
}

/**
 * Schema guard — verifies the parsed output shape hasn't drifted.
 * Returns { ok: true, jobs } or { ok: false, reason }.
 */
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
