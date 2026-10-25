import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { httpFixture, users } from '../tests/cloud/fixture';

// Isolated, synthetic accounts. No Google login, production DB or real forms.
const app = await httpFixture(resolve('build/cloud-ui'));
await app.pool.query("UPDATE hanu.accounts SET role='admin' WHERE user_id=$1", [users[0]]);
await app.pool.query('DELETE FROM hanu.accounts WHERE user_id=$1', [users[1]]);
await app.api('auth/me', 1);
const samples = [
  ['Nguyễn Minh Anh', 'minhanh@example.test', 'pending'], ['Trần Khánh Linh', 'khanhlinh@example.test', 'active'],
  ['Lê Hoàng Nam', 'hoangnam@example.test', 'active'], ['Phạm Ngọc Hà', 'ngocha@example.test', 'blocked'],
  ['Vũ Thu Trang', 'thutrang@example.test', 'pending'], ['Đỗ Quang Huy', 'quanghuy@example.test', 'active']
];
for (const [name, email, status] of samples) {
  const id = crypto.randomUUID(); await app.pool.query('INSERT INTO auth.users(id) VALUES($1)', [id]);
  await app.pool.query(`INSERT INTO hanu.accounts(user_id,email,email_verified,name,status,contact_name,phone,purpose,consent_at,max_profiles,max_concurrent,live_enabled)
    VALUES($1,$2,true,$3,$4,$3,'0901234567','Chuẩn bị hồ sơ đăng ký HSK cho nhóm học viên',now(),8,3,$5)`, [id, email, name, status, status === 'active']);
}
const paired = await app.pair(users[0]);
await app.pool.query('UPDATE hanu.sessions SET owner=$2 WHERE owner=$1 AND id=$3', [users[0], users[1], paired.sessionId]);
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chromium', headless: true });
await mkdir('test-results', { recursive: true });
try {
  const errors: string[] = [];
  const admin = await browser.newContext({ viewport: { width: 1512, height: 1050 }, colorScheme: 'light' });
  await admin.addCookies([{ name: 'test-account', value: 'account-a', url: app.config.origin }]);
  const page = await admin.newPage(); page.setDefaultTimeout(10000); page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${app.config.origin}/admin`);
  await expect(page.getByRole('heading', { name: 'Người dùng', exact: true })).toBeVisible();
  await expect(page.getByRole('table')).toContainText('khanhlinh@example.test');
  await page.screenshot({ path: 'test-results/access-admin-light.png', fullPage: true });
  await page.getByLabel('Đổi giao diện sáng tối').click();
  await expect(page.locator('.admin-application')).toHaveClass(/dark/);
  await page.screenshot({ path: 'test-results/access-admin-dark.png', fullPage: true });
  await page.getByLabel('Đổi giao diện sáng tối').click();
  await page.getByLabel('Tìm người dùng').fill('binh@example.test');
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Xét duyệt', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('binh@example.test');
  await expect(page.getByRole('dialog')).not.toContainText('hoàn tất thông tin');
  await page.screenshot({ path: 'test-results/access-admin-detail.png', fullPage: true });
  await page.getByLabel('Đóng chi tiết tài khoản').click();

  const member = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  await member.addCookies([{ name: 'test-account', value: 'account-b', url: app.config.origin }]);
  const user = await member.newPage(); user.on('pageerror', e => errors.push(e.message));
  await user.goto(app.config.origin);
  await expect(user.getByRole('heading', { name: 'Yêu cầu của bạn đang chờ duyệt.' })).toBeVisible();
  await expect(user.getByRole('textbox')).toHaveCount(0);
  await expect(user.getByRole('checkbox')).toHaveCount(0);
  await user.screenshot({ path: 'test-results/access-pending.png', fullPage: true });
  await user.setViewportSize({ width: 390, height: 844 });
  expect(await user.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await user.screenshot({ path: 'test-results/access-pending-mobile.png', fullPage: true });
  await user.emulateMedia({ colorScheme: 'dark' }); await user.reload();
  await expect(user.getByRole('heading', { name: 'Yêu cầu của bạn đang chờ duyệt.' })).toBeVisible();
  await user.screenshot({ path: 'test-results/access-pending-dark-mobile.png', fullPage: true });
  await user.emulateMedia({ colorScheme: 'light' });
  await user.setViewportSize({ width: 1440, height: 1000 }); await user.reload();


  await page.getByLabel('Tìm người dùng').fill('binh@example.test');
  await page.getByLabel('Làm mới danh sách').click();
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: 'Xét duyệt', exact: true }).click();
  await page.getByLabel('Trạng thái', { exact: true }).selectOption('active');
  await page.getByLabel('Profile tối đa').fill('6');
  await page.getByLabel('Chạy đồng thời').fill('2');
  await page.getByRole('button', { name: 'Lưu quyền sử dụng', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Đã lưu quyền sử dụng');
  await page.getByLabel('Đóng chi tiết tài khoản').click();
  await user.getByRole('button', { name: 'Kiểm tra trạng thái', exact: true }).click();
  await expect(user.getByRole('heading', { name: 'Quản lý các phiên' })).toBeVisible();
  await expect(user.locator('table')).toContainText('Chrome thử An');
  await expect(user.locator('option[value=live]')).toBeDisabled();
  const memberStore = app.repository.store(users[1]);
  await memberStore.connected(paired.sessionId, false);
  // Refresh the manager snapshot after this fixture-only disconnect.
  app.app.runtimes.get(users[1])!.coordinator.changed();
  await expect(user.locator('table')).toContainText('Mất kết nối');
  await expect(user.getByRole('button', { name: 'Hủy liên kết Chrome thử An', exact: true })).toBeEnabled();
  await user.getByRole('button', { name: 'Hủy liên kết Chrome thử An', exact: true }).click();
  await expect(user.getByRole('dialog')).toContainText('Xóa vĩnh viễn profile, hồ sơ, ảnh, lịch sử');
  await user.screenshot({ path: 'test-results/access-unlink-confirm.png', fullPage: true });
  await user.getByRole('button', { name: 'Giữ liên kết', exact: true }).click();
  expect((await memberStore.session(paired.sessionId)).linked).toBe(true);
  await user.getByRole('button', { name: 'Chi tiết', exact: true }).click();
  await user.getByRole('button', { name: 'Hủy liên kết', exact: true }).click();
  await expect(user.getByRole('region', { name: 'Xác nhận hủy liên kết' })).toBeVisible();
  await user.screenshot({ path: 'test-results/access-unlink-detail.png', fullPage: true });
  await user.getByRole('button', { name: 'Giữ liên kết', exact: true }).click();
  await user.getByRole('button', { name: 'Đóng chi tiết', exact: true }).first().click();
  await user.getByRole('button', { name: 'Hủy liên kết Chrome thử An', exact: true }).click();
  await user.getByRole('dialog').getByRole('button', { name: 'Xóa vĩnh viễn', exact: true }).click();
  await expect(user.getByRole('button',{name:'Hủy liên kết Chrome thử An',exact:true})).toHaveCount(0);
  await expect.poll(async()=> (await memberStore.sessions()).length).toBe(0);
  await expect(memberStore.session(paired.sessionId)).rejects.toMatchObject({status:404});
  await user.screenshot({path:'test-results/access-profile-deleted.png',fullPage:true});
  await user.goto(`${app.config.origin}/admin`);
  await expect(user.getByRole('heading', { name: 'Chỉ dành cho quản trị viên' })).toBeVisible();
  expect(await user.evaluate(async () => (await fetch('/api/admin/accounts')).status)).toBe(403);

  await page.getByRole('button', { name: 'Cấp quyền trước', exact: true }).click();
  await page.getByLabel('Email Google').fill('new.member@example.test');
  await page.getByRole('button', { name: 'Cấp quyền', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Quyền cấp trước', exact: true })).toBeVisible();
  await expect(page.locator('.admin-grants-list')).toContainText('new.member@example.test');
  await page.getByRole('button', { name: 'Nhật ký quản trị', exact: true }).click();
  await expect(page.locator('.admin-event-list')).toContainText('Cấp quyền trước theo email');
  await page.getByRole('button', { name: /^Người dùng/ }).first().click();
  await page.getByLabel('Tìm người dùng').fill('binh@example.test');
  await page.getByRole('button', { name: 'Chi tiết', exact: true }).click();
  await page.getByLabel('Trạng thái', { exact: true }).selectOption('blocked');
  await page.getByRole('button', { name: 'Lưu quyền sử dụng', exact: true }).click();
  await expect(page.getByText('Khóa tài khoản này?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Đã lưu quyền sử dụng');
  await page.getByLabel('Đóng chi tiết tài khoản').click();
  await user.goto(app.config.origin);
  await expect(user.getByRole('heading', { name: 'Tài khoản đang bị khóa.' })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Tìm người dùng').fill('');
  await expect(page.locator('.admin-users-table tbody tr')).toHaveCount(8);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/access-admin-mobile.png', fullPage: true });
  await user.setViewportSize({ width: 390, height: 844 });
  expect(await user.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await user.screenshot({ path: 'test-results/access-account-mobile.png', fullPage: true });
  await user.emulateMedia({ colorScheme: 'dark' }); await user.reload();
  await user.screenshot({ path: 'test-results/access-account-dark.png', fullPage: true });
  expect(errors).toEqual([]);
  console.log('PASS: admin light/dark/mobile, search, account detail, Google-only pending and approval, offline unlink, quotas, pre-approval, audit, member/admin separation and account lock. Synthetic fixtures only.');
} catch(error) { for(const context of browser.contexts()) for(const page of context.pages()) { console.log('FAIL PAGE',page.url(),(await page.locator('body').innerText()).slice(0,6000)); await page.screenshot({path:`test-results/access-failure-${browser.contexts().indexOf(context)}.png`,fullPage:true}); } throw error; } finally { await browser.close(); await app.close(); }
