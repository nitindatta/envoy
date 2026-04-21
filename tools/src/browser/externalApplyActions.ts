import { existsSync } from 'node:fs';
import type { Page } from 'playwright-core';
import { observeExternalApplyPage } from './externalApplyObserver.js';

export type ExternalApplyActionType =
  | 'fill_text'
  | 'select_option'
  | 'set_checkbox'
  | 'set_radio'
  | 'upload_file'
  | 'click';

export type ExternalApplyAction = {
  action_type: ExternalApplyActionType;
  element_id: string;
  value?: string | null;
};

export type ExternalApplyActionResult = {
  ok: boolean;
  action_type: ExternalApplyActionType;
  element_id: string;
  message: string;
  value_after: string | null;
  navigated: boolean;
  new_url: string | null;
  errors: string[];
};

export function elementIdSelector(elementId: string): string {
  const escaped = elementId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `[data-envoy-apply-id="${escaped}"]`;
}

export function truthyFormValue(value: string | null | undefined): boolean {
  return ['1', 'true', 'yes', 'y', 'checked', 'on'].includes((value ?? '').trim().toLowerCase());
}

export async function executeExternalApplyAction(
  page: Page,
  action: ExternalApplyAction,
): Promise<ExternalApplyActionResult> {
  const previousUrl = page.url();
  const target = page.locator(elementIdSelector(action.element_id)).first();
  const exists = await target.count().catch(() => 0);
  if (!exists) {
    return actionResult(action, {
      ok: false,
      message: `Element not found for id ${action.element_id}`,
      newUrl: page.url(),
      previousUrl,
    });
  }

  try {
    if (action.action_type === 'fill_text') {
      if (action.value == null) throw new Error('fill_text requires value');
      await target.fill(action.value);
    } else if (action.action_type === 'select_option') {
      if (action.value == null) throw new Error('select_option requires value');
      await target.selectOption({ label: action.value }).catch(async () => {
        await target.selectOption({ value: action.value ?? '' });
      });
    } else if (action.action_type === 'set_checkbox') {
      if (truthyFormValue(action.value)) await target.check();
      else await target.uncheck();
    } else if (action.action_type === 'set_radio') {
      if (action.value == null) throw new Error('set_radio requires value');
      await clickRadioOption(page, action.element_id, action.value);
    } else if (action.action_type === 'upload_file') {
      if (!action.value) throw new Error('upload_file requires file path');
      if (!existsSync(action.value)) throw new Error(`file does not exist: ${action.value}`);
      await target.setInputFiles(action.value);
    } else if (action.action_type === 'click') {
      await target.click();
      await Promise.race([
        page.waitForURL((url) => url.toString() !== previousUrl, { timeout: 8_000 }).catch(() => {}),
        page.waitForLoadState('domcontentloaded', { timeout: 8_000 }).catch(() => {}),
        page.waitForTimeout(1_000),
      ]);
    }

    await page.waitForTimeout(300);
    const observation = await observeExternalApplyPage(page).catch(() => null);
    const matchingField = observation?.fields.find((field) => field.element_id === action.element_id);
    return actionResult(action, {
      ok: true,
      message: 'action executed',
      valueAfter: matchingField?.current_value ?? null,
      errors: observation?.errors ?? [],
      newUrl: page.url(),
      previousUrl,
    });
  } catch (err) {
    const observation = await observeExternalApplyPage(page).catch(() => null);
    return actionResult(action, {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
      errors: observation?.errors ?? [],
      newUrl: page.url(),
      previousUrl,
    });
  }
}

async function clickRadioOption(page: Page, elementId: string, value: string): Promise<void> {
  const radios = page.locator(`${elementIdSelector(elementId)} input[type="radio"]`);
  const count = await radios.count();
  if (!count) {
    await page.locator(elementIdSelector(elementId)).first().check();
    return;
  }

  const targetValue = value.trim().toLowerCase();
  for (let index = 0; index < count; index += 1) {
    const radio = radios.nth(index);
    const label = await radio.evaluate((node) => {
      const input = node as HTMLInputElement;
      const explicit = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
      const wrapping = input.closest('label');
      return (explicit?.textContent ?? wrapping?.textContent ?? input.value ?? '').trim();
    });
    if (label.toLowerCase() === targetValue || label.toLowerCase().includes(targetValue)) {
      await radio.click();
      return;
    }
  }

  throw new Error(`No radio option matching "${value}"`);
}

function actionResult(
  action: ExternalApplyAction,
  options: {
    ok: boolean;
    message: string;
    valueAfter?: string | null;
    errors?: string[];
    newUrl: string;
    previousUrl: string;
  },
): ExternalApplyActionResult {
  return {
    ok: options.ok,
    action_type: action.action_type,
    element_id: action.element_id,
    message: options.message,
    value_after: options.valueAfter ?? null,
    navigated: options.newUrl !== options.previousUrl,
    new_url: options.newUrl,
    errors: options.errors ?? [],
  };
}
