import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { completeWizard, launch as start, newUserData } from './helpers';

let userData: string;
const launch = async () => {
  const session = await start(userData);
  const wizard = session.page.getByRole('heading', { name: 'Configuration de votre commerce' });
  if (await wizard.isVisible()) await completeWizard(session.page);
  await session.page.getByRole('link', { name: 'État du système' }).click();
  return session;
};

test.beforeEach(() => { userData = newUserData(); });
test.afterEach(() => rmSync(userData, { recursive: true, force: true }));

test('démarre sur une base chiffrée intègre', async () => {
  const { app, page } = await launch();
  await expect(page.getByRole('heading', { name: 'État du système', level: 1 })).toBeVisible();
  await expect(page.getByText('Chiffrée', { exact: true })).toBeVisible();
  await expect(page.getByText('Intègre', { exact: true })).toBeVisible();
  await expect(page.getByText('Non altéré', { exact: true })).toBeVisible();
  await expect(page.getByText('0.1.0', { exact: true })).toBeVisible();
  await app.close();
  expect(readdirSync(userData)).toContain('gestion.db');
  expect(readFileSync(join(userData, 'gestion.db')).subarray(0, 15).toString()).not.toBe('SQLite format 3');
});

test('isole le renderer et valide les requêtes', async () => {
  const { app, page } = await launch();
  await expect(page.getByText('Chiffrée', { exact: true })).toBeVisible();
  const probe = await page.evaluate(async () => {
    const w = window as unknown as { api: { invoke: (c: string, i: unknown) => Promise<unknown> }; require?: unknown; process?: unknown };
    return {
      require: typeof w.require,
      process: typeof w.process,
      apiKeys: Object.keys(w.api),
      unknown: await w.api.invoke('db.drop', undefined).then(() => 'accepté', () => 'rejeté'),
      invalid: await w.api.invoke('settings.setTheme', { theme: 'rose' }),
      inlineScriptBlocked: (() => {
        const script = document.createElement('script');
        script.textContent = 'window.__injected = true';
        document.head.append(script);
        return !(window as unknown as { __injected?: boolean }).__injected;
      })(),
    };
  });
  expect(probe).toEqual({
    require: 'undefined',
    process: 'undefined',
    apiKeys: ['invoke'],
    unknown: 'rejeté',
    invalid: { ok: false, error: { code: 'INVALID_INPUT', message: 'Données invalides.' } },
    inlineScriptBlocked: true,
  });
  await app.close();
});

test('conserve le thème et le journal après redémarrage', async () => {
  let { app, page } = await launch();
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Paramètres' }).click();
  await page.getByRole('link', { name: 'Apparence' }).click();
  await page.getByText('Sombre', { exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('radio', { name: 'Sombre' })).toBeChecked();
  await app.close();

  ({ app, page } = await launch());
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('link', { name: 'État du système' }).click();
  const row = page.locator('div', { has: page.getByText('Opérations journalisées') }).last();
  await expect(row).toContainText('4');
  await expect(page.getByText('Non altéré', { exact: true })).toBeVisible();
  await app.close();
});
