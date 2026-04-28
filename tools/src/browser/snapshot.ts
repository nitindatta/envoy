import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright-core';

const ARTIFACT_DIR = path.resolve(process.cwd(), '..', 'automation', 'artifacts');

export async function saveSnapshot(
  page: Page,
  kind: 'screenshot' | 'dom' | 'drift',
  label?: string,
): Promise<string> {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
  const safeLabel = (label ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const dir = path.join(ARTIFACT_DIR, kind === 'drift' ? 'drift' : 'snapshots');
  await mkdir(dir, { recursive: true });
  const stem = safeLabel ? `${ts}-${safeLabel}` : ts;

  if (kind === 'screenshot') {
    const filePath = path.join(dir, `${stem}.png`);
    await page.screenshot({ path: filePath, fullPage: true });
    return filePath;
  } else {
    const html = await page.content();
    const filePath = path.join(dir, `${stem}.html`);
    await writeFile(filePath, html, 'utf8');
    return filePath;
  }
}
