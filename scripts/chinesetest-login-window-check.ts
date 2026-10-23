// Real installed Chrome, synthetic pages only. No account, password, cookie export,
// ChineseTest API call or registration request is used by this regression check.
import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { LoginWindow } from '../integrations/chinesetest/runner/login';
import { ORIGIN } from '../integrations/chinesetest/protocol';

const server = createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><body><h1>Local redirect fixture</h1><input aria-label="Fixture account"></body></html>');});
await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
const fixtureOrigin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const original = chromium.launchPersistentContext.bind(chromium);
let context: Awaited<ReturnType<typeof original>>;
let scenario: 'slow-script' | 'network-error' | 'redirect' = 'slow-script';
const login = new LoginWindow(), started = Date.now();
const body = '<!doctype html><html><body><h1>ChineseTest login regression fixture</h1><input aria-label="Fixture account">';
chromium.launchPersistentContext = async (directory, options) => {
  context = await original(directory, options);
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url === ORIGIN + '/pending-script.js') {
      await new Promise<void>(resolve => context.once('close', () => resolve()));
    } else if (url.startsWith(ORIGIN + '/login?')) {
      if (scenario === 'network-error') await route.abort('failed');
      else if (scenario === 'redirect') await route.fulfill({ status: 302, headers: { location: fixtureOrigin+'/personal-test' }, body: '' });
      else await route.fulfill({ contentType: 'text/html', body: body + '<script src="/pending-script.js"></script></body></html>' });
    } else if (url === ORIGIN + '/personal-test') {
      await route.fulfill({ contentType: 'text/html', body: body + '</body></html>' });
    } else await route.abort();
  });
  return context;
};
try {
  await login.open();
  const page = context!.pages()[0];
  await page.getByLabel('Fixture account').fill('synthetic-input-only');
  await page.waitForTimeout(46000);
  expect(login.pending).toBe(true);
  expect(page.isClosed()).toBe(false);
  await expect(page.getByLabel('Fixture account')).toHaveValue('synthetic-input-only');
  console.log('PASS Chrome remains open with entered text after the former 45-second deadline.');
  await login.close();
  expect(login.pending).toBe(false);

  scenario = 'network-error';
  await expect(login.open()).rejects.toThrow('Chrome vẫn mở');
  expect(login.pending).toBe(true);
  const recovery = context!.pages()[0];
  await recovery.goto(ORIGIN + '/personal-test');
  await recovery.getByLabel('Fixture account').fill('recoverable-navigation');
  await expect(recovery.getByLabel('Fixture account')).toHaveValue('recoverable-navigation');
  await context!.close();
  expect(login.pending).toBe(false);
  console.log('PASS failed navigation keeps Chrome usable; closing it manually resets login state.');

  scenario = 'redirect';
  await login.open();
  await expect(context!.pages()[0]).toHaveURL(fixtureOrigin + '/personal-test');
  expect(login.pending).toBe(true);
  await login.close();
  expect(login.pending).toBe(false);
  await mkdir('test-results/chinesetest', { recursive: true });
  await writeFile('test-results/chinesetest/login-window-smoke.json', JSON.stringify({
    platform: process.platform, arch: process.arch, chrome: true,
    slowScriptKeepsWindowOpenAfterMs: 46000, enteredTextPreserved: true,
    failedNavigationRecoverable: true, manualCloseResetsPending: true,
    reopenAndRedirect: true, registrationRequests: 0, elapsedMs: Date.now() - started,
  }, null, 2) + '\n');
  console.log(`PASS native ${process.platform}/${process.arch}: slow loading, network failure, manual close, reopen and redirect. No real login or registration.`);
} finally {
  await login.close();
  chromium.launchPersistentContext = original;
  await new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());});
}
