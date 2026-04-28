import type { Locator, Page } from 'playwright-core';

type ListboxOption = {
  text: string;
  value: string;
  disabled: boolean;
};

type ComboboxControlInfo = {
  textEntryCapable: boolean;
  tagName: string;
  role: string;
};

type ComboboxSurface = {
  selector: string;
  options: ListboxOption[];
};

export type SelectControlDeps = {
  elementIdSelector: (elementId: string) => string;
  safeClick: (page: Page, target: Locator, elementId: string) => Promise<void>;
  maybeWaitForTimeout: (page: Page, timeout: number) => Promise<void>;
  maybePressKey: (page: Page, key: string) => Promise<void>;
  maybeType: (page: Page, value: string) => Promise<void>;
  createError: (message: string, diagnostics?: Record<string, unknown> | null) => Error;
};

const OPTION_ALIAS_GROUPS = [
  ['south australia', 'sa'],
  ['new south wales', 'nsw'],
  ['queensland', 'qld'],
  ['victoria', 'vic'],
  ['tasmania', 'tas'],
  ['western australia', 'wa'],
  ['northern territory', 'nt'],
  ['australian capital territory', 'act'],
  ['mobile', 'mobile phone', 'cell phone', 'cellular', 'smartphone'],
  ['home', 'home phone', 'landline'],
  ['work', 'work phone', 'business phone'],
] as const;

export async function selectExternalOption(
  page: Page,
  target: Locator,
  elementId: string,
  value: string,
  deps: SelectControlDeps,
): Promise<void> {
  const isNativeSelect = await target.evaluate(
    (node) => (node as Element).tagName?.toLowerCase() === 'select',
  ).catch(() => false);
  if (isNativeSelect) {
    await target.selectOption({ label: value }).catch(async () => {
      await target.selectOption({ value });
    });
    return;
  }

  await selectCustomOption(page, elementId, value, deps);
}

async function selectCustomOption(
  page: Page,
  elementId: string,
  value: string,
  deps: SelectControlDeps,
): Promise<void> {
  const combobox = page.locator(deps.elementIdSelector(elementId)).first();
  const control = await describeComboboxControl(combobox);
  const diagnostics: Record<string, unknown> = {
    requested_value: value,
    requested_value_normalized: normalizeOptionText(value),
    text_entry_capable: control.textEntryCapable,
    control_tag: control.tagName,
    control_role: control.role,
  };

  await deps.safeClick(page, combobox, elementId);
  if (control.textEntryCapable) {
    await combobox.focus().catch(() => {});
  }

  const allowsForgivingFallback = await allowsForgivingComboboxFallback(page, elementId, deps);
  diagnostics.allows_forgiving_fallback = allowsForgivingFallback;

  if (!control.textEntryCapable) {
    const locatorResult = await tryClickOptionViaLocator(page, value, allowsForgivingFallback, deps);
    diagnostics.locator_result = locatorResult;
    if (locatorResult === 'selected') {
      return;
    }

    const ownedSurface = await resolveOwnedComboboxSurface(page, elementId, deps, 8, 120);
    diagnostics.owned_options = listboxOptionLabels(ownedSurface?.options ?? []);
    const ownedSelection = ownedSurface
      ? await trySelectFromComboboxSurface(page, elementId, value, ownedSurface, allowsForgivingFallback, diagnostics, deps)
      : 'unavailable';
    if (ownedSelection === 'selected') {
      return;
    }
    if (ownedSelection === 'failed') {
      throw deps.createError(`No combobox option matching "${value}"`, diagnostics);
    }

    const initialSurface = await resolveComboboxSurface(page, elementId, deps, 12, 150);
    diagnostics.initial_options = listboxOptionLabels(initialSurface?.options ?? []);
    const initialSelection = initialSurface
      ? await trySelectFromComboboxSurface(page, elementId, value, initialSurface, allowsForgivingFallback, diagnostics, deps)
      : 'unavailable';
    if (initialSelection === 'selected') {
      return;
    }
    if (initialSelection === 'failed') {
      throw deps.createError(`No combobox option matching "${value}"`, diagnostics);
    }

    const lateOwnedSurface = await resolveOwnedComboboxSurface(
      page,
      elementId,
      deps,
      8,
      120,
      { requireExpanded: false },
    );
    diagnostics.late_owned_options = listboxOptionLabels(lateOwnedSurface?.options ?? []);
    const lateOwnedSelection = lateOwnedSurface
      ? await trySelectFromComboboxSurface(page, elementId, value, lateOwnedSurface, allowsForgivingFallback, diagnostics, deps)
      : 'unavailable';
    if (lateOwnedSelection === 'selected') {
      return;
    }
    if (lateOwnedSelection === 'failed') {
      throw deps.createError(`No combobox option matching "${value}"`, diagnostics);
    }

    throw deps.createError(`No combobox option matching "${value}"`, diagnostics);
  }

  const initialSurface = await resolveComboboxSurface(page, elementId, deps, 8, 80);
  diagnostics.initial_options = listboxOptionLabels(initialSurface?.options ?? []);
  const initialSelection = initialSurface
    ? await trySelectFromComboboxSurface(page, elementId, value, initialSurface, allowsForgivingFallback, diagnostics, deps)
    : 'unavailable';
  if (initialSelection === 'selected') {
    return;
  }
  if (initialSelection === 'failed') {
    throw deps.createError(`No combobox option matching "${value}"`, diagnostics);
  }

  await combobox.fill(value).catch(async () => {
    await deps.safeClick(page, combobox, elementId);
    await deps.maybeType(page, value);
  });
  await deps.maybeWaitForTimeout(page, 250);

  const typedSurface = await resolveComboboxSurface(page, elementId, deps, 8, 120);
  diagnostics.typed_options = listboxOptionLabels(typedSurface?.options ?? []);
  const typedSelection = typedSurface
    ? await trySelectFromComboboxSurface(page, elementId, value, typedSurface, allowsForgivingFallback, diagnostics, deps)
    : 'unavailable';
  if (typedSelection === 'selected') {
    return;
  }
  if (typedSelection === 'failed') {
    throw deps.createError(`No combobox option matching "${value}"`, diagnostics);
  }

  await deps.maybePressKey(page, 'Enter');
  await deps.maybeWaitForTimeout(page, 150);
  const resolved = await readComboboxDisplayValue(page, elementId, deps);
  diagnostics.resolved_display_value = resolved;
  if (resolved && (allowsForgivingFallback || valueMatchesSelection(resolved, value))) {
    return;
  }
  throw deps.createError(`No combobox option matching "${value}"`, diagnostics);
}

async function describeComboboxControl(target: Locator): Promise<ComboboxControlInfo> {
  return target.evaluate((node) => {
    const el = node as HTMLElement;
    const tagName = el.tagName?.toLowerCase() ?? '';
    const role = (el.getAttribute('role') ?? '').toLowerCase();
    return {
      textEntryCapable: tagName === 'input'
        || tagName === 'textarea'
        || role === 'combobox'
        || el.isContentEditable,
      tagName,
      role,
    };
  }).catch(() => ({
    textEntryCapable: false,
    tagName: '',
    role: '',
  }));
}

async function tryClickOptionViaLocator(
  page: Page,
  value: string,
  allowsForgivingFallback: boolean,
  deps: SelectControlDeps,
): Promise<'selected' | 'unavailable' | 'failed'> {
  await deps.maybeWaitForTimeout(page, 300);

  const allOptions = page.locator('[role="listbox"] [role="option"], [role="listbox"] li');
  if (typeof allOptions.nth !== 'function') {
    return 'unavailable';
  }
  const count = await allOptions.count().catch(() => 0);
  if (!count) return 'unavailable';

  const targetVariants = optionMatchVariants(value);
  const optionTexts: string[] = [];
  for (let i = 0; i < count; i++) {
    const text = await allOptions.nth(i).textContent().catch(() => '');
    optionTexts.push(text ?? '');
  }

  for (let i = 0; i < count; i++) {
    const text = optionTexts[i] ?? '';
    const optVariants = optionMatchVariants(text);
    if (hasVariantIntersection(targetVariants, optVariants)) {
      const clicked = await allOptions.nth(i).click({ timeout: 2000 }).then(() => true).catch(() => false);
      return clicked ? 'selected' : 'failed';
    }
  }

  const targetNorm = normalizeOptionText(value);
  for (let i = 0; i < count; i++) {
    const text = optionTexts[i] ?? '';
    const optNorm = normalizeOptionText(text);
    if (optNorm.includes(targetNorm) || targetNorm.includes(optNorm)) {
      const clicked = await allOptions.nth(i).click({ timeout: 2000 }).then(() => true).catch(() => false);
      return clicked ? 'selected' : 'failed';
    }
  }

  if (allowsForgivingFallback) {
    for (let i = 0; i < count; i++) {
      const text = optionTexts[i] ?? '';
      if (!isPlaceholderOption(text)) {
        const clicked = await allOptions.nth(i).click({ timeout: 2000 }).then(() => true).catch(() => false);
        return clicked ? 'selected' : 'failed';
      }
    }
  }

  return 'failed';
}

async function resolveComboboxSurface(
  page: Page,
  elementId: string,
  deps: SelectControlDeps,
  attempts = 6,
  waitMs = 80,
): Promise<ComboboxSurface | null> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const surface = await page.evaluate(
      ({ targetSelector }) => {
        let target = document.querySelector(targetSelector);
        if (!(target instanceof HTMLElement)) {
          target = document.querySelector(
            'button[aria-haspopup="listbox"][aria-expanded="true"], [role="combobox"][aria-expanded="true"], [role="button"][aria-haspopup="listbox"][aria-expanded="true"]',
          );
          if (!(target instanceof HTMLElement)) return null;
        }

        const cleanText = (value: string | null | undefined): string =>
          (value ?? '').replace(/[\u2060\u200b\u200c\u200d\uFEFF]/g, '').replace(/\s+/g, ' ').trim();

        const isVisible = (node: Element): boolean => {
          if (!(node instanceof window.HTMLElement)) return false;
          if (node.hidden) return false;
          const style = window.getComputedStyle(node);
          return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
        };

        const listboxes = Array.from(document.querySelectorAll('[role="listbox"]'))
          .filter(isVisible) as HTMLElement[];
        if (!listboxes.length) return null;

        const ownedId = target.getAttribute('aria-owns') || target.getAttribute('aria-controls')
          || (target.querySelector('[aria-controls]') as HTMLElement | null)?.getAttribute('aria-controls')
          || (target.querySelector('[aria-owns]') as HTMLElement | null)?.getAttribute('aria-owns') || '';
        const owned = ownedId ? document.getElementById(ownedId) : null;
        let chosen = owned instanceof HTMLElement && isVisible(owned) ? owned : null;
        if (!chosen) {
          if (listboxes.length === 1) {
            chosen = listboxes[0] ?? null;
          } else {
            const targetRect = target.getBoundingClientRect();
            const targetCenterX = targetRect.left + targetRect.width / 2;
            const targetCenterY = targetRect.top + targetRect.height / 2;
            chosen = listboxes
              .map((listbox) => {
                const surface = (listbox.closest('[data-popper-placement]') as HTMLElement | null) ?? listbox;
                const rect = surface.getBoundingClientRect();
                const dx = (rect.left + rect.width / 2) - targetCenterX;
                const dy = (rect.top + rect.height / 2) - targetCenterY;
                return { listbox, distance: Math.sqrt(dx * dx + dy * dy) };
              })
              .sort((left, right) => left.distance - right.distance)[0]?.listbox ?? null;
          }
        }
        if (!chosen) return null;

        document.querySelectorAll('[data-envoy-active-listbox="true"]').forEach((node) => {
          node.removeAttribute('data-envoy-active-listbox');
        });
        chosen.setAttribute('data-envoy-active-listbox', 'true');
        const options = Array.from(chosen.querySelectorAll('[role="option"], li, [data-value]')).map((option) => {
          const el = option as HTMLElement;
          return {
            text: cleanText(el.textContent),
            value: cleanText(el.getAttribute('data-value')),
            disabled: el.getAttribute('aria-disabled') === 'true',
          };
        });
        return {
          selector: '[data-envoy-active-listbox="true"]',
          options,
        };
      },
      { targetSelector: deps.elementIdSelector(elementId) },
    ).catch(() => null);

    if (surface && surface.options.length) {
      return surface;
    }
    if (attempt < attempts - 1) {
      await deps.maybeWaitForTimeout(page, waitMs);
    }
  }
  return null;
}

async function resolveOwnedComboboxSurface(
  page: Page,
  elementId: string,
  deps: SelectControlDeps,
  attempts = 12,
  waitMs = 100,
  options?: { requireExpanded?: boolean },
): Promise<ComboboxSurface | null> {
  const requireExpanded = options?.requireExpanded ?? true;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const surface = await page.evaluate(
      ({ targetSelector, ownedOnly, requireExpanded: mustBeExpanded }) => {
        void ownedOnly;
        let target = document.querySelector(targetSelector);
        if (!(target instanceof HTMLElement)) {
          target = document.querySelector(
            'button[aria-haspopup="listbox"][aria-expanded="true"], [role="combobox"][aria-expanded="true"], [role="button"][aria-haspopup="listbox"][aria-expanded="true"]',
          );
          if (!(target instanceof HTMLElement)) return null;
        }

        const trigger = (
          target.getAttribute('aria-controls') || target.getAttribute('aria-owns')
            ? target
            : (target.querySelector('[aria-controls], [aria-owns]') as HTMLElement | null) ?? target
        ) as HTMLElement;
        if (mustBeExpanded) {
          const expanded =
            (trigger.getAttribute('aria-expanded') ?? '').toLowerCase() === 'true' ||
            target.querySelector('[aria-expanded="true"]') !== null;
          if (!expanded) return null;
        }

        const cleanText = (value: string | null | undefined): string =>
          (value ?? '').replace(/[\u2060\u200b\u200c\u200d\uFEFF]/g, '').replace(/\s+/g, ' ').trim();

        const ownedId = trigger.getAttribute('aria-controls') || trigger.getAttribute('aria-owns') || '';
        if (!ownedId) return null;
        const owned = document.getElementById(ownedId);
        if (!(owned instanceof HTMLElement)) return null;

        const listboxOptions = Array.from(owned.querySelectorAll('[role="option"], li, [data-value]')).map((option) => {
          const el = option as HTMLElement;
          return {
            text: cleanText(el.textContent),
            value: cleanText(el.getAttribute('data-value')),
            disabled: el.getAttribute('aria-disabled') === 'true',
          };
        });
        if (!listboxOptions.length) {
          return null;
        }

        document.querySelectorAll('[data-envoy-active-listbox="true"]').forEach((node) => {
          node.removeAttribute('data-envoy-active-listbox');
        });
        owned.setAttribute('data-envoy-active-listbox', 'true');
        return {
          selector: '[data-envoy-active-listbox="true"]',
          options: listboxOptions,
        };
      },
      {
        targetSelector: deps.elementIdSelector(elementId),
        ownedOnly: true,
        requireExpanded,
      },
    ).catch(() => null);

    if (surface && surface.options.length) {
      return surface;
    }
    if (attempt < attempts - 1) {
      await deps.maybeWaitForTimeout(page, waitMs);
    }
  }
  return null;
}

async function trySelectFromComboboxSurface(
  page: Page,
  elementId: string,
  value: string,
  surface: ComboboxSurface,
  allowsForgivingFallback: boolean,
  diagnostics: Record<string, unknown>,
  deps: SelectControlDeps,
): Promise<'selected' | 'unavailable' | 'failed'> {
  const target = value.trim().toLowerCase();
  const exact = findMatchingListboxOption(surface.options, target);
  if (exact) {
    if (!await clickSpecificComboboxOption(page, surface.selector, exact)) {
      diagnostics.selected_option = exact.text || exact.value;
      return 'failed';
    }
    if (await verifyComboboxSelection(page, elementId, exact, allowsForgivingFallback, deps)) {
      return 'selected';
    }
    diagnostics.selected_option = exact.text || exact.value;
    diagnostics.resolved_display_value = await readComboboxDisplayValue(page, elementId, deps);
    throw deps.createError(`Combobox selection did not stick for "${value}"`, diagnostics);
  }

  if (allowsForgivingFallback) {
    const fallback = firstUsableListboxOption(surface.options);
    if (!fallback) {
      return 'unavailable';
    }
    if (!await clickSpecificComboboxOption(page, surface.selector, fallback)) {
      diagnostics.selected_option = fallback.text || fallback.value;
      return 'failed';
    }
    if (await verifyComboboxSelection(page, elementId, fallback, true, deps)) {
      return 'selected';
    }
    diagnostics.selected_option = fallback.text || fallback.value;
    diagnostics.resolved_display_value = await readComboboxDisplayValue(page, elementId, deps);
    throw deps.createError(`Combobox fallback selection did not stick for "${value}"`, diagnostics);
  }

  return 'unavailable';
}

function findMatchingListboxOption(options: ListboxOption[], target: string): ListboxOption | null {
  return (
    options.find((option) => optionMatchesTarget(option, target) && !option.disabled)
    || options.find((option) => optionLooselyMatchesTarget(option, target) && !option.disabled)
    || null
  );
}

async function clickSpecificComboboxOption(
  page: Page,
  listboxSelector: string,
  option: ListboxOption,
): Promise<boolean> {
  return page.evaluate(
    ({ sel, wantText, wantValue }) => {
      const listbox = document.querySelector(sel);
      if (!listbox) return false;
      const options = Array.from(listbox.querySelectorAll('[role="option"], li, [data-value]'));
      const match = options.find((candidate) => {
        const el = candidate as HTMLElement;
        const text = (el.textContent ?? '').trim().toLowerCase();
        const value = (el.getAttribute('data-value') ?? '').trim().toLowerCase();
        const disabled = el.getAttribute('aria-disabled') === 'true';
        if (disabled) return false;
        return text === wantText || value === wantValue;
      });
      if (!match) return false;
      (match as HTMLElement).click();
      return true;
    },
    {
      sel: listboxSelector,
      wantText: normalizeOptionText(option.text),
      wantValue: normalizeOptionText(option.value),
    },
  ).catch(() => false);
}

async function verifyComboboxSelection(
  page: Page,
  elementId: string,
  expectedOption: ListboxOption,
  forgiving: boolean,
  deps: SelectControlDeps,
): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const display = await readComboboxDisplayValue(page, elementId, deps);
    if (display) {
      if (forgiving) {
        return !isPlaceholderOption(display);
      }
      if (valueMatchesSelection(display, expectedOption.text) || valueMatchesSelection(display, expectedOption.value)) {
        return true;
      }
    }
    if (attempt < 3) {
      await deps.maybeWaitForTimeout(page, 90);
    }
  }
  return false;
}

async function readComboboxDisplayValue(
  page: Page,
  elementId: string,
  deps: SelectControlDeps,
): Promise<string> {
  return page.evaluate(
    ({ selector }) => {
      const target = document.querySelector(selector);
      if (!(target instanceof HTMLElement)) return '';

      const cleanText = (value: string | null | undefined): string =>
        (value ?? '').replace(/[\u2060\u200b\u200c\u200d\uFEFF]/g, '').replace(/\s+/g, ' ').trim();

      const input = target as HTMLInputElement;
      const ownText = cleanText(target.textContent);
      const ownValue = cleanText(input.value);
      const container = target.closest('[data-automation-id="multiSelectContainer"], [data-uxi-widget-type="multiselect"], [class*="field"], [class*="control"], [class*="input"], form, section, div') ?? target.parentElement;
      const promptText = cleanText(
        container?.querySelector('[data-automation-id="promptOption"], [role="option"][aria-selected="true"]')?.textContent,
      );

      const candidates = [promptText, ownText, ownValue];
      return candidates.find((candidate) => candidate && !/^(select|select one|choose|choose one|please select|please choose)$/i.test(candidate)) ?? '';
    },
    { selector: deps.elementIdSelector(elementId) },
  ).catch(() => '');
}

function valueMatchesSelection(actual: string, expected: string): boolean {
  const actualVariants = optionMatchVariants(actual);
  const expectedVariants = optionMatchVariants(expected);
  if (!actualVariants.size || !expectedVariants.size) {
    return false;
  }
  if (hasVariantIntersection(actualVariants, expectedVariants)) {
    return true;
  }
  return [...actualVariants].some((actualVariant) => (
    [...expectedVariants].some((expectedVariant) => (
      actualVariant.includes(expectedVariant) || expectedVariant.includes(actualVariant)
    ))
  ));
}

function listboxOptionLabels(options: ListboxOption[]): string[] {
  return options
    .map((option) => option.text || option.value)
    .map((value) => value.trim())
    .filter(Boolean);
}

async function allowsForgivingComboboxFallback(
  page: Page,
  elementId: string,
  deps: SelectControlDeps,
): Promise<boolean> {
  return page.evaluate(
    ({ selector }) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return false;
      const id = element.id;
      const explicitLabel = id ? document.querySelector(`label[for="${id}"]`) : null;
      const text = [
        explicitLabel?.textContent ?? '',
        element.getAttribute('aria-label') ?? '',
        element.getAttribute('name') ?? '',
        element.textContent ?? '',
      ].join(' ').toLowerCase();
      return /\b(how did you hear|heard about|source|salutation|honorific|title|phone device type|device type)\b/.test(text);
    },
    { selector: deps.elementIdSelector(elementId) },
  ).catch(() => false);
}

function firstUsableListboxOption(options: ListboxOption[]): ListboxOption | null {
  return options.find((option) => !option.disabled && !isPlaceholderOption(option.text)) ?? null;
}

function isPlaceholderOption(value: string): boolean {
  const normalized = normalizeOptionText(value);
  return normalized === ''
    || ['select', 'select one', 'choose', 'choose one', 'please select', 'please choose'].includes(normalized);
}

function normalizeOptionText(value: string): string {
  return value
    .replace(/[\u2060\u200b\u200c\u200d\uFEFF]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function optionMatchesTarget(option: ListboxOption, target: string): boolean {
  const targetVariants = optionMatchVariants(target);
  if (!targetVariants.size) {
    return false;
  }
  return hasVariantIntersection(optionMatchVariants(option.text), targetVariants)
    || hasVariantIntersection(optionMatchVariants(option.value), targetVariants);
}

function optionLooselyMatchesTarget(option: ListboxOption, target: string): boolean {
  const targetVariants = optionMatchVariants(target);
  if (!targetVariants.size) {
    return false;
  }
  return [...targetVariants].some((targetVariant) => (
    [...optionMatchVariants(option.text), ...optionMatchVariants(option.value)].some((optionVariant) => (
      optionVariant.includes(targetVariant) || targetVariant.includes(optionVariant)
    ))
  ));
}

function optionMatchVariants(value: string): Set<string> {
  const normalized = normalizeOptionText(value);
  if (!normalized) {
    return new Set();
  }
  const variants = new Set([normalized]);
  for (const group of OPTION_ALIAS_GROUPS) {
    const normalizedGroup = group.map((entry) => normalizeOptionText(entry));
    if (!normalizedGroup.includes(normalized)) {
      continue;
    }
    normalizedGroup.forEach((entry) => variants.add(entry));
  }
  return variants;
}

function hasVariantIntersection(left: Set<string>, right: Set<string>): boolean {
  for (const candidate of left) {
    if (right.has(candidate)) {
      return true;
    }
  }
  return false;
}
