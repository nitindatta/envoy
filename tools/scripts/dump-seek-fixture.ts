/**
 * Opens SEEK search results in real Chrome and dumps the rendered HTML to
 * tools/test/fixtures/seek/listing.html. The parser is then developed and
 * tested against that fixture, not the live site.
 *
 * Usage (from tools/):
 *   npm run dump:seek -- "data engineer"
 *   npm run dump:seek -- "data engineer" "Adelaide SA"
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launchChrome } from '../src/browser/chrome.js';

function buildSeekUrl(keywords: string, location?: string): string {
  const kw = keywords.trim().toLowerCase().replace(/\s+/g, '-');
  const base = `https://www.seek.com.au/${encodeURIComponent(kw)}-jobs`;
  if (!location) return base;
  const loc = location.trim().toLowerCase().replace(/\s+/g, '-');
  return `${base}/in-${encodeURIComponent(loc)}`;
}

async function main(): Promise<void> {
  const keywords = process.argv[2];
  const location = process.argv[3];
  if (!keywords) {
    console.error('Usage: npm run dump:seek -- "<keywords>" [location]');
    process.exit(1);
  }

  const url = buildSeekUrl(keywords, location);
  console.log(`[dump-seek] opening ${url}`);

  const context = await launchChrome();
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    // Wait for the listing to settle. SEEK hydrates results client-side.
    // Prefer an explicit selector once known; for now wait on networkidle.
    await page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {
      console.warn('[dump-seek] networkidle timeout, dumping whatever rendered');
    });
    await page.waitForTimeout(2_000);

    const html = await page.content();

    const fixtureDir = path.resolve(process.cwd(), 'test/fixtures/seek');
    await mkdir(fixtureDir, { recursive: true });
    const fixturePath = path.join(fixtureDir, 'listing.html');
    await writeFile(fixturePath, html, 'utf8');

    console.log(`[dump-seek] wrote ${html.length} bytes to ${fixturePath}`);
    console.log('[dump-seek] inspect the page in the browser, then press Ctrl+C to close.');

    // Keep browser open so user can inspect DOM in devtools before closing.
    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => resolve());
    });
  } finally {
    await context.close();
  }
}

void main();
