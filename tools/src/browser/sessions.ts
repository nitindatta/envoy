/**
 * In-memory browser session store.
 *
 * Each session is a single Page (tab) within the shared persistent Chrome
 * context. The context stays alive between sessions so login cookies persist.
 * Closing a session only closes the tab, not the browser.
 */

import { randomUUID } from 'node:crypto';
import type { Page } from 'playwright-core';
import { getOrLaunchChrome } from './chrome.js';

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

export type Session = {
  key: string;
  page: Page;
  provider: string;
  createdAt: Date;
  lastUsedAt: Date;
};

const store = new Map<string, Session>();

/**
 * Open a new tab in the shared Chrome context and mint a session token.
 * Chrome launches on first call; subsequent calls reuse the same process.
 */
export async function createSession(provider: string): Promise<string> {
  const context = await getOrLaunchChrome();
  const page = await context.newPage();
  const key = randomUUID();
  store.set(key, {
    key,
    page,
    provider,
    createdAt: new Date(),
    lastUsedAt: new Date(),
  });
  return key;
}

export function getSession(key: string): Session | undefined {
  const session = store.get(key);
  if (session) session.lastUsedAt = new Date();
  return session;
}

export async function closeSession(key: string): Promise<boolean> {
  const session = store.get(key);
  if (!session) return false;
  store.delete(key);
  try {
    await session.page.close();
  } catch {
    // already closed
  }
  return true;
}

// Reap expired sessions (close their tabs)
setInterval(async () => {
  const now = Date.now();
  for (const [key, session] of store) {
    if (now - session.lastUsedAt.getTime() > SESSION_TTL_MS) {
      console.warn(`[sessions] reaping stale session ${key} (provider=${session.provider})`);
      await closeSession(key);
    }
  }
}, 60_000);
