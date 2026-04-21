export interface GenericExternalStartPage {
  goto(url: string, options: { waitUntil: 'domcontentloaded'; timeout: number }): Promise<unknown>;
  waitForLoadState(state: 'networkidle', options: { timeout: number }): Promise<unknown>;
  waitForTimeout(timeoutMs: number): Promise<unknown>;
  url(): string;
}

export interface GenericExternalStartResult {
  apply_url: string;
  is_external_portal: true;
  portal_type: string;
}

export async function startGenericExternalApply(
  page: GenericExternalStartPage,
  provider: string,
  jobUrl: string,
): Promise<GenericExternalStartResult> {
  await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(1_500);

  return {
    apply_url: page.url(),
    is_external_portal: true,
    portal_type: provider,
  };
}
