import { rmSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { completeWizard, launch, newUserData } from './helpers';

let userData: string;
test.beforeEach(() => { userData = newUserData(); });
test.afterEach(() => rmSync(userData, { recursive: true, force: true }));

test('assistant : bloque sans informations, configure, puis ne réapparaît plus', async () => {
  let { app, page } = await launch(userData);
  await expect(page.getByRole('heading', { name: 'Configuration de votre commerce' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await expect(page.getByRole('alert')).toContainText('Renseignez');

  await completeWizard(page);
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Paramètres' }).click();
  await page.getByRole('link', { name: 'Caractéristiques' }).click();
  await expect(page.getByRole('cell', { name: 'RAM' })).toBeVisible();
  await app.close();

  ({ app, page } = await launch(userData));
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Configuration de votre commerce' })).toHaveCount(0);
  await app.close();
});

test('un commerçant ajoute une caractéristique, et sa configuration persiste', async () => {
  let { app, page } = await launch(userData);
  await completeWizard(page, 'Vêtements');
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Paramètres' }).click();

  await page.getByLabel('Nom commercial').fill('Nouveau nom');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('status')).toHaveText('Enregistré');

  await page.getByRole('link', { name: 'Caractéristiques' }).click();
  await page.getByRole('heading', { name: 'Nouvelle caractéristique' }).waitFor();
  await page.getByLabel('Nom', { exact: true }).fill('Coupe');
  await page.getByLabel('Type').selectOption('SELECT');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('alert')).toContainText('choix');
  await page.getByLabel('Choix').fill('Droite, Slim');
  await page.getByLabel('Vêtements').check();
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('cell', { name: 'Coupe' })).toBeVisible();

  await page.getByRole('link', { name: 'Unités' }).click();
  // Attend le nouvel onglet : sinon « Nom » désigne encore le champ de l'onglet précédent.
  await page.getByRole('heading', { name: 'Nouvelle unité' }).waitFor();
  await page.getByLabel('Nom', { exact: true }).fill('Carton');
  await page.getByLabel('Symbole').fill('ctn');
  await page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(page.getByRole('cell', { name: 'Carton' })).toBeVisible();
  await app.close();

  ({ app, page } = await launch(userData));
  await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Paramètres' }).click();
  await expect(page.getByLabel('Nom commercial')).toHaveValue('Nouveau nom');
  await page.getByRole('link', { name: 'Caractéristiques' }).click();
  await expect(page.getByRole('cell', { name: 'Coupe' })).toBeVisible();
  await app.close();
});
