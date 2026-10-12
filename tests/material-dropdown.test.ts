// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { emptyProfile } from "../src/rules";
import type { ExtensionMessage } from "../src/shared";

type Listener = (message: ExtensionMessage, sender: unknown, respond: (value: unknown) => void) => void;
let listener: Listener;
afterEach(() => {
  listener?.({ type: "HALT_RUN" }, {}, () => {});
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.replaceChildren();
});

async function materialFixture(initial = "", rejectSelection = false) {
  // Structure observed on the user's Google Form, including the presentation
  // separator and a popup INSIDE the listbox; templates lose their role when open.
  const options = `<div role="option" tabindex="0" aria-selected="true" data-value="">Choose</div>
    <div role="presentation"></div>
    <div role="option" tabindex="-1" aria-selected="false" data-value="CCCD   |   身份证">CCCD   |   身份证</div>
    <div role="option" tabindex="-1" aria-selected="false" data-value="HỘ CHIẾU   |   护照">HỘ CHIẾU   |   护照</div>`;
  document.body.innerHTML = `<div role="listitem"><div role="heading">LOẠI GIẤY TỜ TÙY THÂN | 证件类型 *</div>
    <div role="listbox" aria-expanded="false">
      <div jsname="LgbsSe" role="presentation"><div jsname="d9BH4c">${options}</div></div>
      <div jsname="V68bde" class="OA0qNb" role="presentation" aria-hidden="true"></div>
    </div><input type="hidden" name="entry.100" value="${initial}"></div><button>Submit</button>`;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 40 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: () => {} });
  const trigger = document.querySelector<HTMLElement>('[role="listbox"]')!;
  const opener = document.querySelector<HTMLElement>('[jsname="LgbsSe"]')!;
  const popup = document.querySelector<HTMLElement>('[jsname="V68bde"]')!;
  const hidden = document.querySelector<HTMLInputElement>('input')!;
  const openClick = vi.fn(() => {
    const expanded = trigger.getAttribute('aria-expanded') === 'true';
    trigger.setAttribute('aria-expanded', String(!expanded));
    if (!expanded) {
      opener.setAttribute('aria-hidden', 'true');
      opener.querySelectorAll('[role="option"]').forEach(el => el.removeAttribute('role'));
      popup.removeAttribute('aria-hidden');
      popup.innerHTML = options;
    } else popup.setAttribute('aria-hidden', 'true');
  });
  opener.addEventListener('click', openClick);
  popup.addEventListener('click', event => {
    const option = (event.target as Element).closest('[role="option"]');
    if (!option || rejectSelection) return;
    hidden.value = option.getAttribute('data-value')!;
    trigger.setAttribute('aria-expanded', 'false');
    popup.setAttribute('aria-hidden', 'true');
    opener.removeAttribute('aria-hidden');
  });
  const profile = emptyProfile();
  profile.values.identityType = 'CCCD';
  const sent: ExtensionMessage[] = [];
  vi.stubGlobal('chrome', { runtime: {
    onMessage: { addListener: (fn: Listener) => { listener = fn; } },
    sendMessage: vi.fn(async (message: ExtensionMessage) => {
      sent.push(message);
      return message.type === 'GET_PROFILE' ? profile : { ok: true, dispatched: false };
    })
  }});
  const submit = vi.fn();
  document.querySelector('button')!.addEventListener('click', submit);
  await import('../src/content');
  listener({ type: 'RUN_CURRENT_PAGE', mode: 'test' }, {}, () => {});
  return { hidden, openClick, sent, submit };
}

it('opens Material once, selects nested popup and stops before Submit', async () => {
  const fixture = await materialFixture();
  await vi.waitFor(() => expect(fixture.hidden.value).toBe('CCCD   |   身份证'));
  expect(fixture.openClick).toHaveBeenCalledTimes(1);
  expect(fixture.sent).toContainEqual(expect.objectContaining({ type: 'FORM_EVENT', event: expect.objectContaining({ type: 'ready_to_submit' }) }));
  expect(fixture.submit).not.toHaveBeenCalled();
});

it('replaces a previously committed wrong value', async () => {
  const fixture = await materialFixture('HỘ CHIẾU   |   护照');
  await vi.waitFor(() => expect(fixture.hidden.value).toBe('CCCD   |   身份证'));
  expect(fixture.submit).not.toHaveBeenCalled();
});

it('does not report success just because a rejected selection still has an old value', async () => {
  const fixture = await materialFixture('HỘ CHIẾU   |   护照', true);
  await vi.waitFor(() => expect(fixture.sent).toContainEqual(expect.objectContaining({ type: 'FORM_EVENT', event: expect.objectContaining({ type: 'block' }) })), { timeout: 4000 });
  expect(fixture.sent).not.toContainEqual(expect.objectContaining({ type: 'FORM_EVENT', event: expect.objectContaining({ type: 'ready_to_submit' }) }));
  expect(fixture.hidden.value).toBe('HỘ CHIẾU   |   护照');
  expect(fixture.submit).not.toHaveBeenCalled();
});
