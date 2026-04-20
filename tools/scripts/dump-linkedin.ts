/**
 * Opens LinkedIn job search results in real Chrome and dumps the rendered HTML to
 * tools/test/fixtures/linkedin/listing.html. The parser is then developed and
 * tested against that fixture, not the live site.
 *
 * Usage (from tools/):
 *   npm run dump:linkedin -- "data engineer"
 *   npm run dump:linkedin -- "data engineer" "Australia"
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getOrLaunchChrome } from '../src/browser/chrome.js';

function buildLinkedInUrl(keywords: string, location?: string): string {
  const params = new URLSearchParams({ keywords });
  if (location) params.set('location', location);
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

async function main(): Promise<void> {
  const keywords = process.argv[2];
  const location = process.argv[3];
  if (!keywords) {
    console.error('Usage: npm run dump:linkedin -- "<keywords>" [location]');
    process.exit(1);
  }

  const url = buildLinkedInUrl(keywords, location);
  console.log(`[dump-linkedin] opening ${url}`);

  const context = await getOrLaunchChrome();
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {
      console.warn('[dump-linkedin] networkidle timeout, dumping whatever rendered');
    });
    await page.waitForTimeout(2_000);

    const html = await page.content();

    const fixtureDir = path.resolve(process.cwd(), 'test/fixtures/linkedin');
    await mkdir(fixtureDir, { recursive: true });
    const fixturePath = path.join(fixtureDir, 'listing.html');
    await writeFile(fixturePath, html, 'utf8');

    console.log(`[dump-linkedin] wrote ${html.length} bytes to ${fixturePath}`);
    console.log('[dump-linkedin] inspect the page in the browser, then press Ctrl+C to close.');

    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => resolve());
    });
  } finally {
    await context.close();
  }
}

void main();
