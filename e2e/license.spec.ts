import { rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { completeWizard, launch, newUserData, testLicense } from './helpers';

let userData: string;
test.beforeEach(() => { userData = newUserData(); });
test.afterEach(() => rmSync(userData, { recursive: true, force: true }));
const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day).toISOString();
const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Navigation principale' });
const invoke = (page: import('@playwright/test').Page, channel: string, input?: unknown) =>
  page.evaluate(([c, i]) => (window as unknown as { api: { invoke: (a: unknown, b: unknown) => Promise<unknown> } }).api.invoke(c, i), [channel, input] as const);

test('abonnement expiré : vente bloquée par le processus principal, données consultables', async () => {
  const { app, page } = await launch(userData, testLicense({ expiresAt: ago(10), graceUntil: ago(5) }));
  await completeWizard(page);
  await expect(page.getByRole('alert').first()).toContainText('Les nouvelles opérations sont bloquées');
  await expect(await invoke(page, 'customers.save', { id: null, name: 'A', phone: null, whatsapp: null, address: null })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  await expect(await invoke(page, 'customers.list', { search: '' })).toMatchObject({ ok: true });
  await nav(page).getByRole('link', { name: 'Rapports' }).click();
  await expect(page.getByRole('button', { name: 'Exporter en CSV' })).toBeVisible();
  await app.close();
});

test('formule Starter : modules réservés absents et refusés', async () => {
  const { app, page } = await launch(userData, testLicense({ planCode: 'STARTER', features: [], maxUsers: 1 }));
  await completeWizard(page);
  await expect(nav(page).getByRole('link', { name: 'Dépenses' })).toHaveCount(0);
  await expect(nav(page).getByRole('link', { name: 'Caisse' })).toHaveCount(0);
  await expect(await invoke(page, 'cash.open', { openingFloat: 0n })).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  const created = await invoke(page, 'users.save', { id: null, name: 'K', login: 'koffi', role: 'SELLER', overrides: {}, password: 'vendeur123' });
  expect(created).toMatchObject({ ok: false, error: { code: 'CONFLICT' } });
  await app.close();
});

test('sans licence ni serveur configuré : écran d’activation clair', async () => {
  const { app, page } = await launch(userData, null);
  await completeWizard(page, 'Téléphonie', false);
  await expect(page.getByRole('heading', { name: 'Activation du logiciel' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText("n'est pas configuré");
  await app.close();
});
