import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { drift, error, ok, type ToolResponse } from '../../envelope.js';
import { getOrLaunchChrome as launchChrome } from '../../browser/chrome.js';
import { parseListing_guarded } from './parseListing.js';
import { type ProviderJob } from '../types.js';

const RESULTS_PER_PAGE = 25;

const SearchRequestSchema = z.object({
  keywords: z.string().min(1),
  location: z.string().optional(),
  max_pages: z.number().int().min(1).max(10).default(1),
});

function buildLinkedInUrl(keywords: string, location?: string, start = 0): string {
  const params = new URLSearchParams({ keywords, start: String(start) });
  if (location) params.set('location', location);
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

export function registerLinkedInSearchRoute(app: FastifyInstance): void {
  app.post('/tools/providers/linkedin/search', async (request) => {
    const parsed = SearchRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return error('bad_request', parsed.error.message) satisfies ToolResponse<never>;
    }

    const { keywords, location, max_pages } = parsed.data;
    const allJobs: ProviderJob[] = [];

    const context = await launchChrome();
    const page = await context.newPage();
    try {
      for (let pageNum = 1; pageNum <= max_pages; pageNum++) {
        const start = (pageNum - 1) * RESULTS_PER_PAGE;
        const url = buildLinkedInUrl(keywords, location, start);

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(2_000);

        const html = await page.content();
        const result = parseListing_guarded(html);

        if (!result.ok) {
          if (pageNum === 1) {
            return drift('linkedin/search', 'job cards present', result.reason);
          }
          break;
        }

        allJobs.push(...result.jobs);

        if (result.jobs.length < RESULTS_PER_PAGE) break;
      }
    } finally {
      await page.close();
    }

    return ok({ jobs: allJobs });
  });
}
