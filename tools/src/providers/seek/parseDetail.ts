import { JSDOM } from 'jsdom';
import { z } from 'zod';

/**
 * Selectors for SEEK job detail page (seek.com.au/job/:id).
 * More stable than class names — data-automation attributes are SEEK's own
 * test hooks and change less frequently.
 */
const SELECTORS = {
  title: '[data-automation="job-detail-title"]',
  company: '[data-automation="advertiser-name"]',
  location: '[data-automation="job-detail-location"]',
  salary: '[data-automation="job-detail-salary"]',
  workType: '[data-automation="job-detail-work-type"]',
  listedAt: '[data-automation="job-detail-date"]',
  description: '[data-automation="jobAdDetails"]',
  classificationBreadcrumb: '[data-automation="job-detail-classifications"]',
} as const;

export type SeekJobDetail = {
  provider_job_id: string;
  title: string;
  company: string;
  location: string | null;
  salary: string | null;
  work_type: string | null;
  listed_at: string | null;
  description: string;
  classification: string | null;
  url: string;
};

const seekJobDetailSchema = z.object({
  provider_job_id: z.string().min(1),
  title: z.string().min(1),
  company: z.string(),
  description: z.string().min(10),
  url: z.string().url(),
});

export type ParseDetailResult =
  | { ok: true; detail: SeekJobDetail }
  | { ok: false; reason: string };

export function parseDetail(html: string, jobId: string, url: string): ParseDetailResult {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const title = doc.querySelector(SELECTORS.title)?.textContent?.trim() ?? '';
  if (!title) {
    return { ok: false, reason: `no title found for job ${jobId} — selector drift?` };
  }

  const company = doc.querySelector(SELECTORS.company)?.textContent?.trim() ?? '';
  const location = doc.querySelector(SELECTORS.location)?.textContent?.trim() || null;
  const salary = doc.querySelector(SELECTORS.salary)?.textContent?.trim() || null;
  const workType = doc.querySelector(SELECTORS.workType)?.textContent?.trim() || null;
  const listedAt = doc.querySelector(SELECTORS.listedAt)?.textContent?.trim() || null;
  const classification =
    doc.querySelector(SELECTORS.classificationBreadcrumb)?.textContent?.trim() || null;

  const descEl = doc.querySelector(SELECTORS.description);
  const description = descEl?.textContent?.trim() ?? '';
  if (!description) {
    return { ok: false, reason: `no description found for job ${jobId} — selector drift?` };
  }

  const detail: SeekJobDetail = {
    provider_job_id: jobId,
    title,
    company,
    location,
    salary,
    work_type: workType,
    listed_at: listedAt,
    description,
    classification,
    url,
  };

  const validation = seekJobDetailSchema.safeParse(detail);
  if (!validation.success) {
    return { ok: false, reason: `schema guard failed: ${validation.error.message}` };
  }

  return { ok: true, detail };
}
