import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { completeWizard, launch, newUserData } from './helpers';

let userData: string;
test.beforeEach(() => { userData = newUserData(); });
test.afterEach(() => rmSync(userData, { recursive: true, force: true }));
const go = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name, exact: true }).click();

test('rappel : WhatsApp s’ouvre avec le texte, l’état dit seulement « ouvert »', async () => {
  const { app, page } = await launch(userData);
  await completeWizard(page);
  // Intercepte l'ouverture externe : aucun navigateur ni message réel pendant le test.
  await app.evaluate(({ shell }) => {
    (globalThis as unknown as { opened: string[] }).opened = [];
    shell.openExternal = async (url: string) => { (globalThis as unknown as { opened: string[] }).opened.push(url); };
  });
  await go(page, 'Produits');
  await page.getByRole('button', { name: 'Nouveau produit' }).click();
  await page.getByLabel('Nom du produit').fill('Savon');
  await page.getByLabel("Prix d'achat").fill('1');
  await page.getByLabel('Prix de vente').fill('2000');
  await page.getByLabel('Quantité en stock').fill('5');
  await page.getByRole('button', { name: 'Enregistrer le produit' }).click();
  await expect(page.getByRole('cell', { name: 'Savon' })).toBeVisible();
  await go(page, 'Clients');
  await page.getByLabel('Nom', { exact: true }).fill('Kossi');
  await page.getByLabel('WhatsApp').fill('90123456');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('button', { name: 'Kossi' })).toBeVisible();
  await go(page, 'Vendre');
  const search = page.getByLabel('Rechercher un produit');
  await search.fill('Savon');
  await page.getByRole('button', { name: /Savon/ }).click();
  await page.getByLabel('Montant reçu').fill('500');
  await page.getByRole('combobox', { name: /^Client/ }).selectOption({ label: 'Kossi' });
  await page.getByRole('button', { name: 'Valider la vente' }).click();
  await expect(page.getByRole('status')).toContainText('enregistrée');

  await go(page, 'Dettes');
  await page.getByRole('button', { name: 'Rappel' }).click();
  await page.getByLabel('Date du rappel').fill('2030-01-15');
  await page.getByRole('button', { name: 'Programmer' }).click();
  await go(page, 'Rappels');
  await page.getByRole('button', { name: 'Envoyer un rappel WhatsApp' }).click();
  await expect(page.getByRole('cell', { name: 'WhatsApp ouvert' })).toBeVisible();
  const opened = await app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened);
  expect(opened[0]).toContain('https://wa.me/22890123456?text=');
  expect(decodeURIComponent(opened[0]!).replace(/[  ]/g, ' ')).toContain('1 500 FCFA');
  await page.getByRole('button', { name: 'Marquer comme effectué' }).click();
  await expect(page.getByText('Aucun rappel')).toBeVisible();
  await app.close();
});

test('sauvegarde : fichier réellement créé dans le dossier choisi, code affiché', async () => {
  const { app, page } = await launch(userData);
  await completeWizard(page);
  await go(page, 'Clients');
  await page.getByLabel('Nom', { exact: true }).fill('Avant');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('button', { name: 'Avant', exact: true })).toBeVisible();

  const folder = mkdtempSync(join(tmpdir(), 'sauvegardes-'));
  await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, folder);
  await go(page, 'Sauvegardes');
  await page.getByRole('button', { name: 'Choisir le dossier' }).click();
  await expect(page.getByText(folder)).toBeVisible();
  await page.getByRole('button', { name: 'Sauvegarder maintenant' }).click();
  await expect(page.getByRole('status')).toContainText('créée');
  await page.getByRole('button', { name: 'Afficher le code' }).click();
  const code = await page.getByTestId('recovery-code').textContent();
  expect(code).toMatch(/^[A-Z2-9-]{29}$/);

  const fileName = await page.locator('td.px-3 span.font-mono').first().textContent();
  expect(existsSync(join(folder, fileName!))).toBe(true);
  await app.close();
  rmSync(folder, { recursive: true, force: true });
});
