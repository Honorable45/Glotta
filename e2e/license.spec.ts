import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { completeWizard, launch, newUserData, testLicense, testPublicKey } from './helpers';

let userData: string;
test.beforeEach(() => { userData = newUserData(); });
test.afterEach(() => rmSync(userData, { recursive: true, force: true }));
const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const invoke = (page: import('@playwright/test').Page, channel: string, input?: unknown) =>
  page.evaluate(([c, i]) => (window as unknown as { api: { invoke: (a: unknown, b: unknown) => Promise<unknown> } }).api.invoke(c, i), [channel, input] as const);

test('licence suspendue : vente bloquée par le processus principal, données consultables', async () => {
  const { app, page } = await launch(userData, testLicense({ status: 'SUSPENDED' }));
  await completeWizard(page);
  await expect(page.getByRole('alert').first()).toContainText('Les nouvelles opérations sont bloquées');
  await expect(await invoke(page, 'customers.save', { id: null, name: 'A', phone: null, whatsapp: null, address: null })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  await expect(await invoke(page, 'customers.list', { search: '' })).toMatchObject({ ok: true });
  await nav(page).getByRole('link', { name: 'Rapports' }).click();
  await expect(page.getByRole('button', { name: 'Exporter en CSV' })).toBeVisible();
  await app.close();
});

test('essai terminé : consultation conservée, opérations bloquées', async () => {
  const { app, page } = await launch(userData, testLicense({ isTrial: true, trialEndsAt: new Date(Date.now() - 86_400_000).toISOString() }));
  await completeWizard(page);
  await expect(page.getByRole('alert').first()).toContainText('essai est terminé');
  await expect(await invoke(page, 'sales.list', { limit: 10 })).toMatchObject({ ok: true });
  await expect(await invoke(page, 'customers.save', { id: null, name: 'A', phone: null, whatsapp: null, address: null })).toMatchObject({ ok: false });
  await app.close();
});

test('édition limitée : modules réservés absents et refusés', async () => {
  const { app, page } = await launch(userData, testLicense({ editionCode: 'BASE', features: [], maxUsers: 1 }));
  await completeWizard(page);
  await expect(nav(page).getByRole('link', { name: 'Dépenses' })).toHaveCount(0);
  await expect(nav(page).getByRole('link', { name: 'Caisse' })).toHaveCount(0);
  await expect(nav(page).getByRole('link', { name: 'Synchronisation' })).toHaveCount(0);
  await expect(await invoke(page, 'cash.open', { openingFloat: 0n })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  await expect(await invoke(page, 'sync.enable')).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  const created = await invoke(page, 'users.save', { id: null, name: 'K', login: 'koffi', role: 'SELLER', overrides: {}, password: 'vendeur123' });
  expect(created).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  await app.close();
});

test('sans licence : activation proposée, et les données restent consultables', async () => {
  const { app, page } = await launch(userData, null);
  await completeWizard(page, 'Téléphonie', false);
  await expect(page.getByRole('heading', { name: 'Activation du logiciel' })).toBeVisible();
  await page.getByRole('button', { name: 'Consulter mes données sans activer' }).click();
  await expect(page.getByRole('alert').first()).toContainText("n'est pas activé");
  await nav(page).getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(await invoke(page, 'customers.list', { search: '' })).toMatchObject({ ok: true });
  await expect(await invoke(page, 'customers.save', { id: null, name: 'A', phone: null, whatsapp: null, address: null })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  await app.close();
});

test('code de récupération imposé au premier lancement, puis plus jamais', async () => {
  let { app, page } = await launch(userData);
  await page.getByLabel('Nom commercial').fill('Boutique');
  await page.getByLabel('Adresse').fill('Lomé');
  await page.getByLabel('Téléphone').fill('+228 90 00 00 00');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByText('Téléphonie', { exact: true }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Votre nom').fill('Patron');
  await page.getByLabel('Identifiant de connexion').fill('patron');
  await page.getByLabel(/^Mot de passe/).fill('motdepasse');
  await page.getByLabel('Confirmer le mot de passe').fill('motdepasse');
  await page.getByRole('button', { name: 'Terminer la configuration' }).click();
  await page.getByTestId('first-recovery-code').waitFor();
  await page.getByLabel('Recopiez le code pour confirmer').fill('AAAAA-AAAAA-AAAAA');
  await page.getByRole('button', { name: "J'ai noté mon code" }).click();
  await expect(page.getByRole('alert')).toContainText('ne correspond pas');
  await expect(nav(page)).toHaveCount(0);
  await page.getByLabel('Recopiez le code pour confirmer').fill((await page.getByTestId('first-recovery-code').textContent())!);
  await page.getByRole('button', { name: "J'ai noté mon code" }).click();
  await nav(page).waitFor();
  await app.close();
  ({ app, page } = await launch(userData));
  await expect(nav(page)).toBeVisible();
  await expect(page.getByTestId('first-recovery-code')).toHaveCount(0);
  await app.close();
});

test('grande version non couverte : refus avant migration, base intacte', async () => {
  // Crée la base avec une version couverte, puis repart avec une grande version supérieure.
  const license = testLicense({ maxMajorVersion: 1 });
  const { app, page } = await launch(userData, license);
  await completeWizard(page);
  await app.close();
  const before = readdirSync(userData).filter((name) => name.startsWith('sauvegardes-migration')).flatMap((name) => readdirSync(join(userData, name)));

  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const electronPath = resolve('node_modules/.bin/electron');
  const child = spawn(electronPath, ['--no-sandbox', resolve('apps/desktop')], {
    env: { ...env, GESTION_USER_DATA: userData, GESTION_ALLOW_BASIC_STORAGE: '1', GESTION_LICENSE_PUBLIC_KEY: testPublicKey, GESTION_TEST_LICENSE: license, GESTION_TEST_APP_VERSION: '9.0.0' },
  });
  let output = '';
  child.stderr.on('data', (chunk) => { output += String(chunk); });
  const code = await new Promise<number | null>((done) => child.on('exit', done));
  expect(output, output).toContain('couvre les versions');
  expect(code).toBe(3);
  expect(existsSync(join(userData, 'gestion.db'))).toBe(true);
  const after = readdirSync(userData).filter((name) => name.startsWith('sauvegardes-migration')).flatMap((name) => readdirSync(join(userData, name)));
  expect(after).toEqual(before);

  const reopened = await launch(userData, license);
  await expect(reopened.page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
  await reopened.app.close();
});
