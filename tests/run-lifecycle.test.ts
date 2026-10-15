// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { emptyProfile } from '../src/rules';
import type { ExtensionMessage } from '../src/shared';

type Listener = (message: ExtensionMessage, sender?: unknown, respond?: (value: unknown) => void) => void;
let listener: Listener;
afterEach(() => {
  listener?.({ type: 'HALT_RUN' });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  document.body.replaceChildren();
});

async function fixture() {
  // Upload deliberately comes first, as on the live shuffled form.
  document.body.innerHTML = `<div role="listitem" data-item-id="file">
    <div role="heading">ẢNH MẶT TRƯỚC GTTT CỦA THÍ SINH | 身份证件图 *</div>
    <p>Upload 1 supported file: PDF or image.</p><button>Add file</button>
  </div><div role="listitem"><div role="heading">Số điện thoại *</div><input type="text"></div>
  <button id="next">Next</button>`;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 40 } as DOMRect);
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
  const profile = emptyProfile();
  profile.values.phone = '0900000000';
  const sent: ExtensionMessage[] = [];
  vi.stubGlobal('chrome', { runtime: {
    onMessage: { addListener: (fn: Listener) => { listener = fn; } },
    sendMessage: vi.fn(async (msg: ExtensionMessage) => {
      sent.push(msg);
      return msg.type === 'TRUSTED_CLICK' ? {dispatched:false} : msg.type === 'GET_PROFILE' ? profile : undefined;
    })
  }});
  const submit = vi.fn();
  const next = vi.fn(() => {
    document.body.innerHTML = '<button>Submit</button>';
    document.querySelector('button')!.addEventListener('click', submit);
  });
  document.querySelector('#next')!.addEventListener('click', next);
  await import('../src/content');
  listener({ type: 'RUN_CURRENT_PAGE', mode: 'test' });
  await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ type: 'FORM_EVENT', event: expect.objectContaining({ type: 'block' }) })));
  return { sent, next, submit };
}

it('fills normal fields before pausing on a required upload even when it is first', async () => {
  const { next } = await fixture();
  expect(document.querySelector('input')!.value).toBe('0900000000');
  expect(next).not.toHaveBeenCalled();
});

it('resumes from asynchronous upload completion, advances, and never submits in Test mode', async () => {
  const { sent, next, submit } = await fixture();
  // Picker changes the card asynchronously; no input/change/click is emitted.
  document.querySelector('[data-item-id="file"]')!.insertAdjacentHTML('beforeend', '<button aria-label="Remove file">×</button>');
  await vi.waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ type: 'FORM_EVENT', event: { type: 'ready_to_submit' } })), { timeout: 2000 });
  expect(next).toHaveBeenCalledTimes(1);
  const manual = sent.findIndex(m => m.type === 'FORM_EVENT' && m.event.type === 'progress' && m.event.message.startsWith('Đã nhận thao tác thủ công'));
  const advanced = sent.findIndex(m => m.type === 'FORM_EVENT' && m.event.type === 'page_advanced');
  expect(manual).toBeGreaterThan(-1);
  expect(advanced).toBeGreaterThan(manual);
  expect(submit).not.toHaveBeenCalled();
});

it('HALT cancels the upload observer and prevents automatic navigation', async () => {
  const { next } = await fixture();
  listener({ type: 'HALT_RUN' });
  document.querySelector('[data-item-id="file"]')!.insertAdjacentHTML('beforeend', '<button aria-label="Remove file">×</button>');
  await new Promise(resolve => setTimeout(resolve, 400));
  expect(next).not.toHaveBeenCalled();
});
