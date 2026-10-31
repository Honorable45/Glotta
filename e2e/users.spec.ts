import { rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { completeWizard, launch, login, newUserData } from './helpers';

let userData: string;
test.beforeEach(() => { userData = newUserData(); });
test.afterEach(() => rmSync(userData, { recursive: true, force: true }));
const nav = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });

test('un vendeur ne voit que ses écrans, et le processus principal refuse le reste', async () => {
  let { app, page } = await launch(userData);
  await completeWizard(page);
  await nav(page).getByRole('link', { name: 'Employés' }).click();
  await page.getByLabel('Nom', { exact: true }).fill('Koffi');
  await page.getByLabel('Identifiant').fill('koffi');
  await page.getByLabel('Mot de passe').fill('vendeur123');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('cell', { name: 'koffi', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();

  // Mauvais mot de passe : refus sans détail.
  await page.getByLabel('Identifiant').fill('koffi');
  await page.getByLabel('Mot de passe').fill('faux-mot-de-passe');
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await expect(page.getByRole('alert')).toContainText('incorrect');

  await login(page, 'koffi', 'vendeur123');
  await expect(nav(page).getByRole('link', { name: 'Vendre', exact: true })).toBeVisible();
  for (const hidden of ['Employés', 'Dépenses', 'Tableau de bord', 'Rapports', "Journal d'activité"]) {
    await expect(nav(page).getByRole('link', { name: hidden })).toHaveCount(0);
  }
  await expect(page.getByLabel('Remise globale')).toHaveCount(0);

  // Appels directs, comme un renderer compromis.
  const denied = await page.evaluate(async () => {
    const api = (window as unknown as { api: { invoke: (c: string, i?: unknown) => Promise<{ ok: boolean; error?: { code: string } }> } }).api;
    return Promise.all([
      api.invoke('users.list'),
      api.invoke('audit.list', { limit: 10 }),
      api.invoke('users.setDisabled', { id: 'x', disabled: true }),
      api.invoke('reports.run', { kind: 'dailySales', period: { from: '2020-01-01T00:00:00.000Z', to: '2030-01-01T00:00:00.000Z' } }),
    ]);
  });
  for (const result of denied) expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  await app.close();

  ({ app, page } = await launch(userData));
  await nav(page).getByRole('link', { name: "Journal d'activité" }).click();
  await expect(page.getByRole('row', { name: /Connexion refusée/ })).toBeVisible();
  await expect(page.getByRole('row', { name: /Koffi.*Connexion/ }).first()).toBeVisible();
  await app.close();
});

test('sans session, aucune donnée n’est accessible', async () => {
  const { app, page } = await launch(userData);
  await completeWizard(page);
  await page.getByRole('button', { name: 'Se déconnecter' }).click();
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
  const results = await page.evaluate(async () => {
    const api = (window as unknown as { api: { invoke: (c: string, i?: unknown) => Promise<{ ok: boolean; error?: { code: string } }> } }).api;
    return Promise.all([api.invoke('company.get'), api.invoke('customers.list', { search: '' }), api.invoke('system.getStatus')]);
  });
  for (const result of results) expect(result).toMatchObject({ ok: false, error: { code: 'UNAUTHENTICATED' } });
  await app.close();
});
