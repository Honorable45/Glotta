import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { generateLicenseKeys, signLicense, type LicensePayload } from '../packages/license/src/index';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const keys = generateLicenseKeys();
const day = 86_400_000;

/** Licence réellement signée : l'application la vérifie comme en production. */
export function testLicense(changes: Partial<LicensePayload> = {}): string {
  const now = Date.now();
  return signLicense(
    {
      tenantId: 'test', deviceId: 'test', planCode: 'BUSINESS', isTrial: false, suspended: false, maxUsers: 15, maxStores: 100,
      features: ['advanced_debts', 'reminders', 'expenses', 'cash', 'advanced_reports', 'export_files', 'multi_store', 'consolidated', 'advanced_permissions'],
      expiresAt: new Date(now + 30 * day).toISOString(),
      graceUntil: new Date(now + 33 * day).toISOString(),
      offlineUntil: new Date(now + 7 * day).toISOString(),
      issuedAt: new Date(now).toISOString(),
      ...changes,
    },
    keys.privateKeyPem,
  );
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

/** Lance le logiciel relié à un vrai serveur d'abonnements. */
export async function launchWithServer(userData: string, apiUrl: string, publicKey: string): Promise<{ app: ElectronApplication; page: Page }> {
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const app = await electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...env, GESTION_USER_DATA: userData, GESTION_ALLOW_BASIC_STORAGE: '1', GESTION_LICENSE_PUBLIC_KEY: publicKey, GESTION_API_URL: apiUrl } as Record<string, string>,
  });
  return { app, page: await app.firstWindow() };
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
  if (expectNav) await page.getByRole('navigation', { name: 'Navigation principale' }).waitFor();
}
