import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright-core';

const ARTIFACT_DIR = path.resolve(process.cwd(), '..', 'automation', 'artifacts');

export async function saveSnapshot(page: Page, kind: 'screenshot' | 'dom' | 'drift'): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.join(ARTIFACT_DIR, kind === 'drift' ? 'drift' : 'snapshots');
  await mkdir(dir, { recursive: true });

  if (kind === 'screenshot') {
    const filePath = path.join(dir, `${ts}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } else {
    const html = await page.content();
    const filePath = path.join(dir, `${ts}.html`);
    await writeFile(filePath, html, 'utf8');
    return filePath;
  }
}
