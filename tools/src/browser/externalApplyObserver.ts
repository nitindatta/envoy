import type { Page } from 'playwright-core';

export type ObservedField = {
  element_id: string;
  label: string;
  field_type: string;
  required: boolean;
  current_value: string | null;
  options: string[];
  nearby_text: string;
  disabled: boolean;
  visible: boolean;
};

export type ObservedAction = {
  element_id: string;
  label: string;
  kind: 'button' | 'link' | 'submit' | 'unknown';
  href: string | null;
  disabled: boolean;
  nearby_text: string;
};

export type PageObservation = {
  url: string;
  title: string;
  page_type: string;
  visible_text: string;
  fields: ObservedField[];
  buttons: ObservedAction[];
  links: ObservedAction[];
  uploads: ObservedField[];
  errors: string[];
  screenshot_ref: string | null;
};

export async function observeExternalApplyPage(page: Page): Promise<PageObservation> {
  await page.waitForLoadState('domcontentloaded', { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  return page.evaluate(buildExternalApplyObservationExpression());
}

export function buildExternalApplyObservationExpression(source = collectExternalApplyObservation.toString()): string {
  const wrappedSource = `(${normalizeInjectedNameHelpers(source)})`;
  return `
    (() => {
      const __envoyName = (value) => value;
      const collect = eval(${JSON.stringify(wrappedSource)});
      return collect();
    })()
  `;
}

export function evaluateExternalApplyObservation(source: string): PageObservation {
  const __envoyName = <T>(value: T): T => value;
  const collect = eval(`(${normalizeInjectedNameHelpers(source)})`) as () => PageObservation;
  void __envoyName;
  return collect();
}

export function normalizeInjectedNameHelpers(source: string): string {
  return source.replace(/\b__name\d*\b/g, '__envoyName');
}

export function collectExternalApplyObservation(): PageObservation {
  const cleanText = (value: string | null | undefined, max = 600): string =>
    (value ?? '').replace(/[\u2060\u200b\u200c\u200d\uFEFF]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

  const isVisible = (el: Element): boolean => {
    if (!(el instanceof window.HTMLElement)) return false;
    if (el.hidden || el.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  };

  const assignElementId = (el: Element, prefix: string): string => {
    const attr = 'data-envoy-apply-id';
    const existing = el.getAttribute(attr);
    if (existing) return existing;
    const next = `${prefix}_${document.querySelectorAll(`[${attr}]`).length + 1}`;
    el.setAttribute(attr, next);
    return next;
  };

  const nearestContainer = (el: Element): Element =>
    el.closest('fieldset, [class*="question"], [class*="field"], [class*="form-group"], [class*="control"], [class*="input"], form, section, div')
    ?? el;

  const textNear = (el: Element, max = 320): string => cleanText(nearestContainer(el).textContent, max);

  const labelForInput = (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string => {
    const labels = Array.from(document.querySelectorAll('label'));
    const explicit = input.id ? labels.find((label) => label.htmlFor === input.id) : null;
    const wrapping = input.closest('label');
    const fieldsetLegend = input.closest('fieldset')?.querySelector('legend');
    const containerLabel = nearestContainer(input).querySelector('label, [class*="label"], [class*="title"], [class*="heading"]');
    return cleanText(
      explicit?.textContent
      ?? wrapping?.textContent
      ?? fieldsetLegend?.textContent
      ?? containerLabel?.textContent
      ?? input.getAttribute('aria-label')
      ?? input.getAttribute('placeholder')
      ?? input.name
      ?? input.id,
      240,
    );
  };

  const requiredFor = (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): boolean => {
    const nearby = textNear(input, 180).toLowerCase();
    return input.required || input.getAttribute('aria-required') === 'true' || nearby.includes('required') || /\*\s*$/.test(labelForInput(input));
  };

  const fieldTypeFor = (input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string => {
    const tag = input.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return 'select';
    const rawType = (input as HTMLInputElement).type?.toLowerCase() || 'text';
    if (rawType === 'tel') return 'phone';
    return rawType;
  };

  const optionLabelFor = (input: HTMLInputElement): string => {
    const labels = Array.from(document.querySelectorAll('label'));
    const explicit = input.id ? labels.find((label) => label.htmlFor === input.id) : null;
    const wrapping = input.closest('label');
    return cleanText(explicit?.textContent ?? wrapping?.textContent ?? input.value, 160);
  };

  const fields: ObservedField[] = [];
  const radioGroups = new Set<string>();
  const inputs = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select',
  ));

  for (const input of inputs) {
    if (!isVisible(input)) continue;
    const type = fieldTypeFor(input);

    if (type === 'radio') {
      const radio = input as HTMLInputElement;
      const groupName = radio.name || radio.id;
      if (radioGroups.has(groupName)) continue;
      radioGroups.add(groupName);

      const groupRadios = inputs
        .filter((candidate): candidate is HTMLInputElement =>
          candidate instanceof window.HTMLInputElement && candidate.type === 'radio' && (candidate.name || candidate.id) === groupName);
      const container = radio.closest('fieldset') ?? nearestContainer(radio);
      const checked = groupRadios.find((candidate) => candidate.checked);
      fields.push({
        element_id: assignElementId(container, 'field'),
        label: cleanText(container.querySelector('legend')?.textContent ?? labelForInput(radio), 240),
        field_type: 'radio',
        required: groupRadios.some((candidate) => candidate.required) || textNear(container).toLowerCase().includes('required'),
        current_value: checked ? optionLabelFor(checked) : null,
        options: groupRadios.map(optionLabelFor).filter(Boolean),
        nearby_text: textNear(container),
        disabled: groupRadios.every((candidate) => candidate.disabled),
        visible: true,
      });
      continue;
    }

    const options = input instanceof window.HTMLSelectElement
      ? Array.from(input.options).map((option) => cleanText(option.textContent, 160)).filter(Boolean)
      : [];
    const currentValue = input instanceof window.HTMLInputElement && input.type === 'checkbox'
      ? (input.checked ? 'checked' : null)
      : ((input as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value || null);

    fields.push({
      element_id: assignElementId(input, 'field'),
      label: labelForInput(input),
      field_type: type,
      required: requiredFor(input),
      current_value: currentValue,
      options,
      nearby_text: textNear(input),
      disabled: input.disabled,
      visible: true,
    });
  }

  const actionLabel = (el: HTMLElement): string => {
    const candidates = [
      el.textContent,
      el instanceof window.HTMLInputElement ? el.value : '',
      el.getAttribute('aria-label'),
      el.getAttribute('title'),
    ];
    return cleanText(candidates.find((candidate) => cleanText(candidate, 180)) ?? '', 180);
  };

  const buttons: ObservedAction[] = [];
  const buttonElements = Array.from(document.querySelectorAll<HTMLElement>(
    'button, input[type="submit"], input[type="button"], [role="button"]',
  ));
  for (const button of buttonElements) {
    if (!isVisible(button)) continue;
    const label = actionLabel(button);
    if (!label) continue;
    const inputType = button instanceof window.HTMLInputElement ? button.type.toLowerCase() : '';
    const kind = inputType === 'submit' || (button instanceof window.HTMLButtonElement && button.type === 'submit') ? 'submit' : 'button';
    buttons.push({
      element_id: assignElementId(button, 'button'),
      label,
      kind,
      href: null,
      disabled: button.hasAttribute('disabled') || button.getAttribute('aria-disabled') === 'true',
      nearby_text: textNear(button, 220),
    });
  }

  const links: ObservedAction[] = [];
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    if (!isVisible(link)) continue;
    const label = cleanText(link.textContent ?? link.getAttribute('aria-label') ?? link.href, 180);
    if (!label) continue;
    links.push({
      element_id: assignElementId(link, 'link'),
      label,
      kind: 'link',
      href: link.href,
      disabled: link.getAttribute('aria-disabled') === 'true',
      nearby_text: textNear(link, 220),
    });
  }

  const errors = Array.from(document.querySelectorAll<HTMLElement>(
    '[role="alert"], [aria-live], [class*="error"], [class*="invalid"], [data-testid*="error"], [id*="error"]',
  ))
    .filter(isVisible)
    .map((el) => cleanText(el.textContent, 260))
    .filter(Boolean);
  for (const input of inputs) {
    if ('validationMessage' in input && input.validationMessage) {
      errors.push(cleanText(input.validationMessage, 220));
    }
  }

  const visibleText = cleanText(document.body?.innerText ?? document.body?.textContent, 6000);
  const uploads = fields.filter((field) => field.field_type === 'file');
  const lowerText = visibleText.toLowerCase();
  const page_type =
    /captcha|robot|recaptcha/.test(lowerText) ? 'captcha'
    : /application (submitted|received|successful|complete)|thank you for applying/.test(lowerText) ? 'confirmation'
    : /sign in|log in|login/.test(lowerText) && fields.some((field) => /email|password/i.test(field.label)) ? 'login'
    : uploads.length > 0 ? 'resume_upload'
    : /review|summary|confirm/.test(lowerText) && buttons.some((button) => /submit|apply/i.test(button.label)) ? 'review'
    : fields.length > 0 ? 'form'
    : 'unknown';

  return {
    url: window.location.href,
    title: document.title,
    page_type,
    visible_text: visibleText,
    fields,
    buttons,
    links,
    uploads,
    errors: Array.from(new Set(errors)).slice(0, 12),
    screenshot_ref: null,
  };
}
