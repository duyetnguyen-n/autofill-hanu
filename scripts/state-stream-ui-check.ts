import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { httpFixture, users } from '../tests/cloud/fixture';

const fixture = await httpFixture(resolve('build/cloud-ui'));
const paired = await fixture.pair();
const browser = await chromium.launch({ channel: 'chromium', headless: true });
try {
  const page = await browser.newPage(), errors: string[] = [], frames: any[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('websocket', socket => socket.on('framereceived', frame => frames.push(JSON.parse(String(frame.payload)))));
  await page.goto(fixture.config.origin);
  await page.getByRole('button', { name: 'Tiếp tục với Google', exact: true }).click();
  await expect(page.locator('table')).toContainText('Chrome thử An');
  await expect.poll(() => frames.some(m => m.type === 'STATE')).toBe(true);
  const runtime = fixture.app.runtimes.get(users[0])!;
  await runtime.coordinator.edit(paired.sessionId, { name: 'Đã đổi qua bản tin nhỏ' });
  await expect(page.locator('table')).toContainText('Đã đổi qua bản tin nhỏ');
  expect(frames.some(m => m.type === 'STATE_PATCH')).toBe(true);
  const snapshots = frames.filter(m => m.type === 'STATE').length;
  for (const socket of runtime.browsers) socket.close(4000, 'Fixture disconnect');
  await runtime.coordinator.edit(paired.sessionId, { name: 'Đồng bộ sau mất mạng' });
  await expect(page.locator('table')).toContainText('Đồng bộ sau mất mạng', { timeout: 10000 });
  await expect.poll(() => frames.filter(m => m.type === 'STATE').length).toBeGreaterThan(snapshots);
  // A bad base revision must trigger reconnect, not leave partial UI data.
  const beforeInvalid = frames.filter(m => m.type === 'STATE').length;
  for (const socket of runtime.browsers) socket.send(JSON.stringify({ type: 'STATE_PATCH', streamVersion: 1, baseRevision: -1, revision: 999, changes: [] }));
  await expect.poll(() => frames.filter(m => m.type === 'STATE').length, { timeout: 10000 }).toBeGreaterThan(beforeInvalid);
  await expect(page.locator('table')).toContainText('Đồng bộ sau mất mạng');
  expect(errors).toEqual([]);
  console.log('PASS: built cloud UI receives deltas, reconnects after disconnect and invalid revision, restores full state; no browser errors. Local auth/database fixture.');
} finally { await browser.close(); await fixture.close(); }
