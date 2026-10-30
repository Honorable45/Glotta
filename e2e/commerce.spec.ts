import { rmSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { completeWizard, launch, newUserData } from './helpers';

let userData: string;
test.beforeEach(() => { userData = newUserData(); });
test.afterEach(() => rmSync(userData, { recursive: true, force: true }));
const go = (page: Page, name: string) => page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name, exact: true }).click();
const clean = (text: string | null) => (text ?? '').replace(/[  ]/g, ' ');

async function createProduct(page: Page, name: string, barcode: string, price: string, stock: string) {
  await go(page, 'Produits');
  await page.getByRole('button', { name: 'Nouveau produit' }).click();
  await page.getByLabel('Nom du produit').fill(name);
  await page.getByLabel('Code-barres').fill(barcode);
  await page.getByLabel("Prix d'achat").fill('600');
  await page.getByLabel('Prix de vente').fill(price);
  await page.getByLabel('Stock initial').fill(stock);
  await page.getByRole('button', { name: 'Enregistrer le produit' }).click();
  await expect(page.getByRole('cell', { name })).toBeVisible();
}

test('vente complète au scanner : stock, crédit, retour et persistance', async () => {
  let { app, page } = await launch(userData);
  await completeWizard(page);
  await createProduct(page, 'Coque Galaxy', '111222', '1000', '5');

  await go(page, 'Clients');
  await page.getByLabel('Nom', { exact: true }).fill('Afi Mensah');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('button', { name: 'Afi Mensah' })).toBeVisible();

  // Un scanner tape le code puis Entrée.
  await go(page, 'Vente');
  const search = page.getByLabel('Rechercher un produit');
  await search.fill('111222');
  await search.press('Enter');
  await search.fill('111222');
  await search.press('Enter');
  await expect(page.getByLabel('Quantité de Coque Galaxy')).toHaveValue('2');
  await expect.poll(async () => clean(await page.getByTestId('total').textContent())).toBe('2 000 FCFA');

  // Crédit sans client : refusé.
  await page.getByLabel('Montant reçu').fill('500');
  await page.getByRole('button', { name: 'Valider la vente' }).click();
  await expect(page.getByRole('alert').first()).toContainText('client');

  await page.getByLabel('Client').selectOption({ label: 'Afi Mensah' });
  await page.getByRole('button', { name: 'Valider la vente' }).click();
  await expect(page.getByRole('status')).toContainText('enregistrée');
  await expect(page.getByLabel('Montant reçu')).toHaveValue('');

  // Vente au-delà du stock : refusée côté métier.
  await search.fill('111222');
  await search.press('Enter');
  await page.getByLabel('Quantité de Coque Galaxy').fill('4');
  await page.getByRole('button', { name: 'Valider la vente' }).click();
  await expect(page.getByRole('alert').first()).toContainText('Stock insuffisant');
  await app.close();

  ({ app, page } = await launch(userData));
  await go(page, 'Clients');
  const row = page.getByRole('row', { name: /Afi Mensah/ });
  await expect.poll(async () => clean(await row.textContent())).toContain('1 500 FCFA');

  await go(page, 'Ventes');
  await page.getByRole('button', { name: /^V-/ }).click();
  await page.getByRole('button', { name: 'Enregistrer un retour' }).click();
  await page.getByLabel('Quantité retournée de Coque Galaxy').fill('1');
  await page.getByLabel('Motif').fill('Mauvais modèle');
  await page.getByRole('button', { name: 'Confirmer le retour' }).click();
  await expect(page.getByRole('cell', { name: '1', exact: true }).first()).toBeVisible();

  await go(page, 'Stock');
  const levels = page.getByRole('row', { name: /Coque Galaxy/ });
  await expect.poll(async () => clean(await levels.textContent())).toContain('4 pce');
  await app.close();
});

test('inventaire : corrige un écart et le trace dans les mouvements', async () => {
  const { app, page } = await launch(userData);
  await completeWizard(page, 'Commerce général');
  await createProduct(page, 'Riz', '333', '500', '10');
  await go(page, 'Stock');
  await page.getByText('Inventaire', { exact: true }).click();
  await page.getByRole('button', { name: 'Démarrer un inventaire' }).click();
  const input = page.getByLabel('Quantité comptée de Riz');
  await input.fill('8');
  await input.blur();
  await page.getByRole('button', { name: "Clôturer l'inventaire" }).click();
  await expect(page.getByRole('status')).toContainText('1 écart');
  await page.getByText('Mouvements', { exact: true }).click();
  await expect(page.getByRole('row', { name: /Inventaire.*-2/ })).toBeVisible();
  await app.close();
});
