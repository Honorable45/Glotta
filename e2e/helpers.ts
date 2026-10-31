import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateLicenseKeys, signLicense, type LicensePayload } from '../packages/license/src/index';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const keys = generateLicenseKeys();
export const testPublicKey = keys.publicKeyPem;

/** Licence réellement signée : l'application la vérifie comme en production. */
export function testLicense(changes: Partial<LicensePayload> = {}): string {
  return signLicense(
    {
      v: 2, licenseId: 'test', activationId: 'test', deviceFingerprint: 'test', editionCode: 'COMPLETE', editionName: 'Complète', isTrial: false, trialEndsAt: null, status: 'ACTIVE', maxUsers: 15, maxStores: 100, maxMajorVersion: 1,
      features: ['advanced_debts', 'reminders', 'expenses', 'cash', 'advanced_reports', 'export_files', 'multi_store', 'consolidated', 'advanced_permissions', 'sync'],
      issuedAt: new Date().toISOString(),
      ...changes,
    },
    keys.privateKeyPem,
  );
}

/** Les tests atteignent tous les écrans ; le menu réduit a son propre test. */
async function openFullMenu(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.setItem('glotta.menu.plus', '1'));
}

export const newUserData = () => mkdtempSync(join(tmpdir(), 'gestion-e2e-'));

export async function launch(userData: string, license: string | null = testLicense()): Promise<{ app: ElectronApplication; page: Page }> {
  // Le terminal de VS Code définit cette variable, qui ferait tourner Electron comme un simple Node.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const app = await electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...env, GESTION_USER_DATA: userData, GESTION_ALLOW_BASIC_STORAGE: '1', GESTION_LICENSE_PUBLIC_KEY: keys.publicKeyPem, ...(license ? { GESTION_TEST_LICENSE: license } : {}) } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await openFullMenu(page);
  const wizard = page.getByRole('heading', { name: 'Configuration de votre commerce' });
  const loginTitle = page.getByRole('heading', { name: 'Connexion' });
  await wizard.or(loginTitle).waitFor();
  if (await loginTitle.isVisible()) await login(page);
  return { app, page };
}

export async function login(page: Page, name = 'patron', password = 'motdepasse'): Promise<void> {
  await page.getByLabel('Identifiant').fill(name);
  await page.getByLabel('Mot de passe').fill(password);
  await page.getByRole('button', { name: 'Se connecter' }).click();
  await page.getByRole('navigation', { name: 'Navigation principale' }).waitFor();
}

/** Lance le logiciel relié à un vrai serveur de licences. */
export async function launchWithServer(userData: string, apiUrl: string | null, publicKey: string): Promise<{ app: ElectronApplication; page: Page }> {
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const app = await electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...env, GESTION_USER_DATA: userData, GESTION_ALLOW_BASIC_STORAGE: '1', GESTION_LICENSE_PUBLIC_KEY: publicKey, ...(apiUrl ? { GESTION_API_URL: apiUrl } : {}) } as Record<string, string>,
  });
  const page = await app.firstWindow();
  await openFullMenu(page);
  return { app, page };
}

/** Le code de récupération est imposé au premier lancement. */
export async function confirmRecoveryCode(page: Page): Promise<string> {
  const code = page.getByTestId('first-recovery-code');
  await code.waitFor();
  const text = (await code.textContent())!;
  await page.getByLabel('Recopiez le code pour confirmer').fill(text);
  await page.getByRole('button', { name: "J'ai noté mon code" }).click();
  return text;
}

/** Passe l'assistant par l'interface, comme un commerçant. */
export async function completeWizard(page: Page, sector = 'Téléphonie', expectNav = true): Promise<void> {
  await page.getByLabel('Nom commercial').fill('Boutique Test');
  await page.getByLabel('Adresse').fill('Lomé');
  await page.getByLabel('Téléphone').fill('+228 90 00 00 00');
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByText(sector, { exact: true }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByRole('button', { name: 'Continuer' }).click();
  await page.getByLabel('Votre nom').fill('Patron');
  await page.getByLabel('Identifiant de connexion').fill('patron');
  await page.getByLabel(/^Mot de passe/).fill('motdepasse');
  await page.getByLabel('Confirmer le mot de passe').fill('motdepasse');
  await page.getByRole('button', { name: 'Terminer la configuration' }).click();
  await confirmRecoveryCode(page);
  if (expectNav) await page.getByRole('navigation', { name: 'Navigation principale' }).waitFor();
}
