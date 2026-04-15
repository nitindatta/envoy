/**
 * SEEK-specific apply flow helpers.
 *
 * All logic that is specific to SEEK's application UI lives here:
 * confirmation page detection, login URL detection, portal type detection,
 * and the start_apply navigation sequence.
 *
 * Generic browser primitives (field extraction, fill, click) stay in browser/.
 */

import type { Page } from 'playwright-core';

// ── Page type detection ────────────────────────────────────────────────────────

export function isExternalPortalUrl(url: string): boolean {
  return (
    !url.includes('seek.com.au') ||
    (url.includes('seek.com.au') && url.includes('/apply/external'))
  );
}

export function isConfirmationPage(pageText: string): boolean {
  return (
    /application (submitted|received|successful|complete|sent)/i.test(pageText) ||
    /thank you for applying/i.test(pageText) ||
    /your application has been (submitted|received|sent)/i.test(pageText) ||
    /you('ve| have) (applied|submitted|sent your application)/i.test(pageText) ||
    /successfully applied/i.test(pageText) ||
    /application sent/i.test(pageText)
  );
}

export function isLoginUrl(url: string): boolean {
  return (
    url.includes('/oauth/') ||
    url.includes('/sign-in') ||
    url.includes('/signin') ||
    url.includes('/login') ||
    url.includes('accounts.seek.com.au')
  );
}

export function detectPortalType(url: string): string {
  if (url.includes('workday.com') || url.includes('myworkdayjobs.com')) return 'workday';
  if (url.includes('greenhouse.io')) return 'greenhouse';
  if (url.includes('lever.co')) return 'lever';
  if (url.includes('icims.com')) return 'icims';
  if (url.includes('successfactors.com')) return 'successfactors';
  if (url.includes('smartrecruiters.com')) return 'smartrecruiters';
  if (url.includes('jobvite.com')) return 'jobvite';
  if (url.includes('taleo.net')) return 'taleo';
  if (url.includes('bamboohr.com')) return 'bamboohr';
  return 'unknown';
}

// ── start_apply ────────────────────────────────────────────────────────────────

export type StartApplyResult =
  | { status: 'ok'; apply_url: string; is_external_portal: boolean; portal_type: string | null }
  | { status: 'needs_human'; reason: string; login_url: string }
  | { status: 'error'; type: string; message: string };

/**
 * Navigate to a SEEK job URL, click Apply, handle redirects, and return the
 * resulting apply URL along with external portal metadata.
 */
export async function startApply(page: Page, jobUrl: string): Promise<StartApplyResult> {
  await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1_500);

  // Check auth before even trying to click Apply
  if (isLoginUrl(page.url())) {
    return { status: 'needs_human', reason: 'auth_required', login_url: page.url() };
  }

  // Click Apply button
  try {
    await page
      .getByRole('link', { name: /apply/i })
      .or(page.getByRole('button', { name: /apply/i }))
      .first()
      .click({ timeout: 10_000 });
  } catch {
    const urlNow = page.url();
    if (isLoginUrl(urlNow)) {
      return { status: 'needs_human', reason: 'auth_required', login_url: urlNow };
    }
    return { status: 'error', type: 'apply_button_not_found', message: `Could not find Apply button on ${urlNow}` };
  }

  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  let applyUrl = page.url();

  if (isLoginUrl(applyUrl)) {
    return { status: 'needs_human', reason: 'auth_required', login_url: applyUrl };
  }

  // SEEK's own /apply/external intermediate page — click through to the employer's ATS
  if (applyUrl.includes('seek.com.au') && applyUrl.includes('/apply/external')) {
    try {
      const clicked = await page
        .getByRole('link', { name: /continue|apply|proceed|go to/i })
        .or(page.getByRole('button', { name: /continue|apply|proceed|go to/i }))
        .first()
        .click({ timeout: 6_000 })
        .then(() => true)
        .catch(() => false);

      if (!clicked) {
        const externalHref = await page.evaluate(() => {
          const a = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))
            .find((el) => el.href && !el.href.includes('seek.com.au'));
          return a ? a.href : null;
        });
        if (externalHref) {
          await page.goto(externalHref, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        }
      }

      await page.waitForLoadState('domcontentloaded', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(2_000);
    } catch {
      // Navigation failed — will be flagged as external below
    }
    applyUrl = page.url();
  }

  const is_external_portal =
    !applyUrl.includes('seek.com.au') ||
    (applyUrl.includes('seek.com.au') && applyUrl.includes('/apply/external'));
  const portal_type = is_external_portal ? detectPortalType(applyUrl) : null;

  return { status: 'ok', apply_url: applyUrl, is_external_portal, portal_type };
}
