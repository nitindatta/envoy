import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { drift, error, ok, type ToolResponse } from '../../envelope.js';
import { getOrLaunchChrome as launchChrome } from '../../browser/chrome.js';
import { parseListing_guarded } from './parseListing.js';
import { type ProviderJob } from '../types.js';

// Re-export alias for backward compatibility with code that imports SeekJob from this module.
export type SeekJob = ProviderJob;

const SearchRequestSchema = z.object({
  keywords: z.string().min(1),
  location: z.string().optional(),
  max_pages: z.number().int().min(1).max(10).default(1),
});

function buildSeekUrl(keywords: string, location?: string): string {
  const kw = keywords.trim().toLowerCase().replace(/\s+/g, '-');
  const base = `https://www.seek.com.au/${encodeURIComponent(kw)}-jobs`;
  if (!location) return base;
  const loc = location.trim().toLowerCase().replace(/\s+/g, '-');
  return `${base}/in-${encodeURIComponent(loc)}`;
}

export function registerSeekSearchRoute(app: FastifyInstance): void {
  app.post('/tools/providers/seek/search', async (request) => {
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
        const url =
          pageNum === 1
            ? buildSeekUrl(keywords, location)
            : `${buildSeekUrl(keywords, location)}?page=${pageNum}`;

        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
        await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
        await page.waitForTimeout(1_500);

        const html = await page.content();
        const result = parseListing_guarded(html);

        if (!result.ok) {
          return drift('seek/search', 'job cards present', result.reason);
        }

        allJobs.push(...result.jobs);

        // Stop early if fewer results than expected (last page)
        if (result.jobs.length < 22) break;
      }
    } finally {
      await page.close(); // close only this tab, not the shared Chrome context
    }

    return ok({ jobs: allJobs });
  });
}
