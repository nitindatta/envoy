/**
 * Opens a LinkedIn job detail page in real Chrome and dumps the rendered HTML to
 * tools/test/fixtures/linkedin/detail.html. The detail parser is then verified
 * and tested against that fixture.
 *
 * Usage (from tools/):
 *   npm run dump:linkedin-detail -- <job_id>
 *
 * Example:
 *   npm run dump:linkedin-detail -- 4193572215
 */

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getOrLaunchChrome } from '../src/browser/chrome.js';

async function main(): Promise<void> {
  const jobId = process.argv[2];
  if (!jobId) {
    console.error('Usage: npm run dump:linkedin-detail -- <job_id>');
    process.exit(1);
  }

  const url = `https://www.linkedin.com/jobs/view/${jobId}`;
  console.log(`[dump-linkedin-detail] opening ${url}`);

  const context = await getOrLaunchChrome();
  try {
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {
      console.warn('[dump-linkedin-detail] networkidle timeout, dumping whatever rendered');
    });
    await page.waitForTimeout(2_000);

    const html = await page.content();

    const fixtureDir = path.resolve(process.cwd(), 'test/fixtures/linkedin');
    await mkdir(fixtureDir, { recursive: true });
    const fixturePath = path.join(fixtureDir, 'detail.html');
    await writeFile(fixturePath, html, 'utf8');

    console.log(`[dump-linkedin-detail] wrote ${html.length} bytes to ${fixturePath}`);
    console.log('[dump-linkedin-detail] inspect the page in devtools, then press Ctrl+C to close.');

    await new Promise<void>((resolve) => {
      process.on('SIGINT', () => resolve());
    });
  } finally {
    await context.close();
  }
}

void main();
