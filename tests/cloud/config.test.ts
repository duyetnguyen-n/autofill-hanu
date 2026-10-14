import { expect, it } from 'vitest';
import { cloudConfig } from '../../manager/cloud/config';

const env = {
  SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'fixture-public',
  SUPABASE_SECRET_KEY: 'fixture-secret', DATABASE_URL: 'postgresql://postgres:fixture@localhost:5432/postgres'
};

it('uses the platform HTTPS URL for the first Render deploy and respects an explicit custom origin', () => {
  const render = { ...env, RENDER: 'true', RENDER_EXTERNAL_URL: 'https://fixture.onrender.com' };
  expect(cloudConfig(render).origin).toBe('https://fixture.onrender.com');
  expect(cloudConfig(render).rollingDeploy).toBe(true);
  expect(cloudConfig({ ...env, PUBLIC_ORIGIN: 'https://custom.example' }).rollingDeploy).toBe(false);
  expect(cloudConfig({ ...render, PUBLIC_ORIGIN: 'https://custom.example' }).origin).toBe('https://custom.example');
  expect(() => cloudConfig({ ...render, PUBLIC_ORIGIN: 'https://YOUR_DOMAIN' })).toThrow('Chưa cấu hình PUBLIC_ORIGIN');
});

it('requires explicit origin outside Render and validates platform URL with the same production rules', () => {
  expect(() => cloudConfig({ ...env, RENDER_EXTERNAL_URL: 'https://fixture.onrender.com' })).toThrow('PUBLIC_ORIGIN');
  for (const url of ['http://fixture.onrender.com', 'https://fixture.onrender.com/path', 'https://user:pass@fixture.onrender.com']) {
    expect(() => cloudConfig({ ...env, RENDER: 'true', RENDER_EXTERNAL_URL: url })).toThrow('HTTPS origin');
  }
});
