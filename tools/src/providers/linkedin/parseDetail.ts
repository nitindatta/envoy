import { JSDOM } from 'jsdom';
import { z } from 'zod';

/**
 * LinkedIn detail pages use fully obfuscated CSS class names that change with
 * each deploy. Stable anchors are:
 *   - <title> tag: "Job Title | Company | LinkedIn"
 *   - [data-testid="expandable-text-box"]: job description
 *   - Location appears in a <p> with bullet-separated spans: "City · N weeks ago · X applicants"
 */

export type LinkedInJobDetail = {
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

const linkedInJobDetailSchema = z.object({
  provider_job_id: z.string().min(1),
  title: z.string().min(1),
  company: z.string(),
  description: z.string().min(10),
  url: z.string().url(),
});

export type ParseDetailResult =
  | { ok: true; detail: LinkedInJobDetail }
  | { ok: false; reason: string };

export function parseDetail(html: string, jobId: string, url: string): ParseDetailResult {
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  // Title and company from <title>: "Job Title | Company | LinkedIn"
  const titleTag = doc.querySelector('title')?.textContent?.trim() ?? '';
  const parts = titleTag.split(' | ');
  const title = parts[0]?.trim() ?? '';
  const company = parts[1]?.trim() ?? '';

  if (!title) {
    return { ok: false, reason: `no title found for job ${jobId} — page may not have loaded or login required` };
  }

  // Description: <span data-testid="expandable-text-box"> can't contain <p> in valid HTML,
  // so browsers auto-close it — the span is empty. Instead, anchor on the stable
  // <h2>About the job</h2> and collect all sibling paragraphs after its parent div.
  const aboutH2 = Array.from(doc.querySelectorAll('h2')).find(
    (h) => h.textContent?.trim() === 'About the job',
  );
  const descParts: string[] = [];
  if (aboutH2) {
    let el = aboutH2.parentElement?.nextElementSibling ?? null;
    while (el) {
      const text = el.textContent?.trim();
      if (text) descParts.push(text);
      el = el.nextElementSibling;
    }
  }
  const description = descParts.join('\n\n');
  if (!description) {
    return { ok: false, reason: `no description found for job ${jobId} — 'About the job' section missing or login required` };
  }

  // Location: find the first <p> whose text contains '·' separator (location · time ago · applicants)
  // Take everything before the first '·' as the location
  let location: string | null = null;
  const paragraphs = Array.from(doc.querySelectorAll('p'));
  for (const p of paragraphs) {
    const text = p.textContent?.trim() ?? '';
    if (text.includes('·')) {
      const candidate = text.split('·')[0]?.trim();
      if (candidate && candidate.length > 1 && candidate.length < 100) {
        location = candidate;
        break;
      }
    }
  }

  const detail: LinkedInJobDetail = {
    provider_job_id: jobId,
    title,
    company,
    location,
    salary: null,
    work_type: null,
    listed_at: null,
    description,
    classification: null,
    url,
  };

  const validation = linkedInJobDetailSchema.safeParse(detail);
  if (!validation.success) {
    return { ok: false, reason: `schema guard failed: ${validation.error.message}` };
  }

  return { ok: true, detail };
}
