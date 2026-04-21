import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import {
  collectExternalApplyObservation,
  evaluateExternalApplyObservation,
  normalizeInjectedNameHelpers,
} from './externalApplyObserver.js';

function withDom<T>(html: string, fn: () => T): T {
  const dom = new JSDOM(html, { url: 'https://ats.example/apply' });
  const previousWindow = (globalThis as { window?: Window }).window;
  const previousDocument = (globalThis as { document?: Document }).document;
  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  try {
    return fn();
  } finally {
    if (previousWindow) (globalThis as { window?: Window }).window = previousWindow;
    else delete (globalThis as { window?: Window }).window;
    if (previousDocument) (globalThis as { document?: Document }).document = previousDocument;
    else delete (globalThis as { document?: Document }).document;
  }
}

describe('collectExternalApplyObservation', () => {
  it('extracts fields, uploads, buttons, links, and errors from a generic apply page', () => {
    const observation = withDom(
      `
      <html>
        <head><title>Apply now</title></head>
        <body>
          <form>
            <label for="name">Full name *</label>
            <input id="name" name="name" required value="Nitin Datta" />
            <label for="email">Email</label>
            <input id="email" type="email" />
            <label for="resume">Resume</label>
            <input id="resume" type="file" />
            <label for="country">Country</label>
            <select id="country"><option>Australia</option><option>New Zealand</option></select>
            <div role="alert">Email is required</div>
            <button type="submit">Continue</button>
            <a href="/privacy">Privacy policy</a>
          </form>
        </body>
      </html>
      `,
      () => collectExternalApplyObservation(),
    );

    expect(observation.url).toBe('https://ats.example/apply');
    expect(observation.title).toBe('Apply now');
    expect(observation.page_type).toBe('resume_upload');
    expect(observation.fields.map((field) => field.label)).toContain('Full name *');
    expect(observation.fields.find((field) => field.label === 'Full name *')?.required).toBe(true);
    expect(observation.uploads).toHaveLength(1);
    expect(observation.buttons[0]?.label).toBe('Continue');
    expect(observation.links[0]?.label).toBe('Privacy policy');
    expect(observation.errors).toContain('Email is required');
  });

  it('collapses radio groups into one observed field with options', () => {
    const observation = withDom(
      `
      <fieldset>
        <legend>Do you have working rights?</legend>
        <input id="rights_yes" type="radio" name="rights" value="yes" />
        <label for="rights_yes">Yes</label>
        <input id="rights_no" type="radio" name="rights" value="no" />
        <label for="rights_no">No</label>
      </fieldset>
      `,
      () => collectExternalApplyObservation(),
    );

    expect(observation.fields).toHaveLength(1);
    expect(observation.fields[0]?.label).toBe('Do you have working rights?');
    expect(observation.fields[0]?.field_type).toBe('radio');
    expect(observation.fields[0]?.options).toEqual(['Yes', 'No']);
  });

  it('evaluates observer source that contains runtime-injected __name helper calls', () => {
    const observation = withDom(
      '<html><head><title>Apply</title></head><body><button>Continue</button></body></html>',
      () => evaluateExternalApplyObservation(`
        function collectExternalApplyObservation() {
          const read = __name27(() => ({
            url: window.location.href,
            title: document.title,
            page_type: 'unknown',
            visible_text: document.body.textContent || '',
            fields: [],
            buttons: [],
            links: [],
            uploads: [],
            errors: [],
            screenshot_ref: null,
          }), 'read');
          return read();
        }
      `),
    );

    expect(observation.url).toBe('https://ats.example/apply');
    expect(observation.title).toBe('Apply');
  });

  it('normalises any TS injected __name helper suffix', () => {
    expect(normalizeInjectedNameHelpers('__name(fn); __name9(fn); __name27(fn);')).toBe(
      '__envoyName(fn); __envoyName(fn); __envoyName(fn);',
    );
  });
});
