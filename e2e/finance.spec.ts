import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { completeWizard, launch, newUserData } from './helpers';

let userData: string;
test.beforeEach(() => { userData = newUserData(); });
test.afterEach(() => rmSync(userData, { recursive: true, force: true }));
const go = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name, exact: true }).click();
const clean = (text: string | null) => (text ?? '').replace(/[  ]/g, ' ');

async function creditSale(page: Page) {
  await go(page, 'Produits');
  await page.getByRole('button', { name: 'Nouveau produit' }).click();
  await page.getByLabel('Nom du produit').fill('Savon');
  await page.getByRole('button', { name: "Plus d'options" }).click();
  await page.getByLabel('Code-barres').fill('555');
  await page.getByLabel("Prix d'achat").fill('600');
  await page.getByLabel('Prix de vente').fill('1000');
  await page.getByLabel('Quantité en stock').fill('10');
  await page.getByRole('button', { name: 'Enregistrer le produit' }).click();
  await expect(page.getByRole('cell', { name: 'Savon' })).toBeVisible();
  await go(page, 'Clients');
  await page.getByLabel('Nom', { exact: true }).fill('Afi');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('button', { name: 'Afi' })).toBeVisible();
  await go(page, 'Vendre');
  const search = page.getByLabel('Rechercher un produit');
  await search.fill('555');
  await search.press('Enter');
  await page.getByLabel('Quantité de Savon').fill('2');
  await page.getByLabel('Montant reçu').fill('500');
  await page.getByRole('combobox', { name: /^Client/ }).selectOption({ label: 'Afi' });
  await page.getByRole('button', { name: 'Valider la vente' }).click();
  await expect(page.getByRole('status')).toContainText('enregistrée');
}

test('dette payée en plusieurs fois, caisse et tableau de bord alignés', async () => {
  const { app, page } = await launch(userData);
  await completeWizard(page);
  await go(page, 'Caisse');
  await page.getByLabel('Solde initial').fill('1000');
  await page.getByRole('button', { name: 'Ouvrir la caisse' }).click();
  await expect(page.getByTestId('expected')).toBeVisible();

  await creditSale(page);

  await go(page, 'Dettes');
  await expect.poll(async () => clean(await page.getByTestId('total-due').textContent())).toBe('1 500 FCFA');
  await page.getByRole('button', { name: 'Encaisser' }).click();
  await page.getByLabel('Montant').fill('5000');
  await page.getByRole('button', { name: 'Encaisser' }).first().click();
  await expect(page.getByRole('alert')).toContainText('dépasse');
  await page.getByLabel('Montant').fill('300');
  await page.getByRole('button', { name: 'Encaisser' }).first().click();
  await expect.poll(async () => clean(await page.getByTestId('total-due').textContent())).toBe('1 200 FCFA');

  await go(page, 'Dépenses');
  await page.getByLabel('Libellé').fill('Taxi');
  await page.getByLabel('Montant', { exact: true }).fill('100');
  await page.getByLabel("Payée avec l'argent de la caisse").check();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('cell', { name: 'Taxi' })).toBeVisible();

  // 1000 initial + 500 + 300 en espèces - 100 de dépense.
  await go(page, 'Caisse');
  await expect.poll(async () => clean(await page.getByTestId('expected').textContent())).toBe('1 700 FCFA');
  await page.getByLabel('Montant compté').fill('1650');
  await page.getByRole('button', { name: 'Fermer la caisse' }).click();
  await expect(page.getByRole('row', { name: /-50/ })).toBeVisible();

  await go(page, 'Tableau de bord');
  const value = (label: string) => page.locator('div', { has: page.getByText(label, { exact: true }) }).last();
  await expect.poll(async () => clean(await value("Chiffre d'affaires de la période").textContent())).toContain('2 000 FCFA');
  await expect.poll(async () => clean(await value('Encaissements').textContent())).toContain('800 FCFA');
  await expect.poll(async () => clean(await value('Marge estimée').textContent())).toContain('800 FCFA');
  await expect.poll(async () => clean(await value('Bénéfice estimé').textContent())).toContain('700 FCFA');
  await expect.poll(async () => clean(await value('Créances clients').textContent())).toContain('1 200 FCFA');

  // Personnalisation conservée.
  await page.getByRole('button', { name: 'Personnaliser' }).click();
  await page.getByLabel('Bénéfice estimé').uncheck();
  await expect(page.getByText('Marge moins dépenses')).toHaveCount(0);
  await app.close();
});

async function mockSave(app: ElectronApplication, path: string) {
  await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, path);
}

test('exporte de vrais fichiers PDF, Excel et CSV', async () => {
  const { app, page } = await launch(userData);
  await completeWizard(page);
  await creditSale(page);
  await go(page, 'Rapports');
  await expect(page.getByRole('cell', { name: 'Total' })).toBeVisible();
  const out = mkdtempSync(join(tmpdir(), 'export-'));
  for (const [button, file, magic] of [['PDF', 'r.pdf', '%PDF'], ['Excel', 'r.xlsx', 'PK'], ['CSV', 'r.csv', '﻿']] as const) {
    const target = join(out, file);
    await mockSave(app, target);
    await page.getByRole('button', { name: `Exporter en ${button}` }).click();
    await expect(page.getByRole('status')).toContainText(file);
    expect(existsSync(target)).toBe(true);
    expect(readFileSync(target).subarray(0, 4).toString().startsWith(magic)).toBe(true);
  }
  await app.close();
  rmSync(out, { recursive: true, force: true });
});
