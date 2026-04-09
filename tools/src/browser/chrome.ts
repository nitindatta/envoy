import { chromium, type BrowserContext } from 'playwright-core';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

/**
 * Singleton Chrome launcher.
 *
 * Uses launchPersistentContext with a fixed profile dir so SEEK (and other
 * provider) cookies survive across apply sessions. Only ONE context can be
 * open at a time per profile dir (Chrome's SingletonLock). We keep it alive
 * for the lifetime of the tools service and create new pages per session.
 */

const CHROME_CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];

const DEFAULT_PROFILE_DIR = path.resolve(process.cwd(), '.chrome-profile');

export type ChromeLaunchOptions = {
  profileDir?: string;
  headless?: boolean;
};

let _context: BrowserContext | null = null;
let _profileDir: string = DEFAULT_PROFILE_DIR;

/**
 * Returns the shared BrowserContext, launching Chrome if not already running.
 * Subsequent calls return the same context — Chrome stays open between sessions
 * so that login cookies persist without re-authentication.
 */
export async function getOrLaunchChrome(options: ChromeLaunchOptions = {}): Promise<BrowserContext> {
  const profileDir = options.profileDir ?? DEFAULT_PROFILE_DIR;
  _profileDir = profileDir;

  if (_context) {
    // Verify the context is still usable
    try {
      await _context.pages(); // throws if browser was closed externally
      return _context;
    } catch {
      _context = null;
    }
  }

  const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
  if (!executablePath) {
    throw new Error(
      `Could not find chrome.exe. Checked: ${CHROME_CANDIDATES.join(', ')}. ` +
        'This launcher must run on Windows with Google Chrome installed.',
    );
  }

  await mkdir(profileDir, { recursive: true });

  _context = await chromium.launchPersistentContext(profileDir, {
    executablePath,
    headless: options.headless ?? false,
    viewport: { width: 1400, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  _context.on('close', () => {
    _context = null;
  });

  return _context;
}

/** Returns the profile dir in use (for diagnostics). */
export function getProfileDir(): string {
  return _profileDir;
}
