import { spawn, type ChildProcess } from 'node:child_process';
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';
import { generateLicenseKeys } from '../packages/license/src/index';
import { totpCode } from '../apps/api/src/totp';
import { completeWizard, launchWithServer, newUserData } from './helpers';

const PORT = 18_081;
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL = 'postgresql://postgres:test@127.0.0.1:55432/gestion_test';
const keys = generateLicenseKeys();
let server: ChildProcess;
let userData: string;

function run(command: string, args: string[], env: Record<string, string>, cwd: string) {
  return new Promise<string>((done, fail) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('exit', (code) => (code === 0 ? done(output) : fail(new Error(output))));
  });
}

test.beforeAll(async () => {
  server = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: resolve('apps/api'),
    // Groupe de processus dédié : npx lance tsx, qui lance node, et tout doit s'arrêter ensemble.
    detached: true,
    env: { ...process.env, DATABASE_URL, LICENSE_PRIVATE_KEY: keys.privateKeyPem, PORT: String(PORT), ADMIN_DIST: resolve('apps/admin/dist') },
  });
  await expect.poll(() => fetch(`${BASE}/v1/plans`).then((response) => response.ok, () => false), { timeout: 30_000 }).toBe(true);
});
test.afterAll(() => { process.kill(-server.pid!); });
test.beforeEach(() => { userData = newUserData(); });
test.afterEach(() => rmSync(userData, { recursive: true, force: true }));

test('de bout en bout : essai depuis le logiciel, suspension par la console, blocage du poste', async () => {
  const email = `${Date.now()}@boutique.tg`;
  const { app, page } = await launchWithServer(userData, BASE, keys.publicKeyPem);
  await completeWizard(page, 'Téléphonie', false);
  await expect(page.getByRole('heading', { name: 'Activation du logiciel' })).toBeVisible();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe du compte').fill('motdepasse1');
  await page.getByRole('button', { name: "Démarrer l'essai gratuit" }).click();
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  const refusal = page.getByRole('alert');
  await nav.or(refusal).waitFor();
  expect(await refusal.count(), await refusal.allTextContents().then(String)).toBe(0);

  await nav.getByRole('link', { name: 'Abonnement' }).click();
  await expect(page.getByText('PRO (essai)')).toBeVisible();
  // Aucun prestataire configuré : refus clair, pas de simulation.
  await page.getByRole('button', { name: /Payer 5/ }).click();
  await expect(page.getByRole('alert')).toContainText('pas encore disponible');

  const admin = `${Date.now()}@admin.tg`;
  const created = await run('npx', ['tsx', 'scripts/create-admin.ts', admin, 'administrateur1'], { DATABASE_URL }, resolve('apps/api'));
  const secret = /authentification : ([A-Z2-7]+)/.exec(created)![1]!;

  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  const consoleApp = await electron.launch({ args: [resolve('e2e/console-shell.cjs')], env: { ...env, CONSOLE_URL: `${BASE}/console/` } as Record<string, string> });
  const consolePage = await consoleApp.firstWindow();
  await consolePage.getByLabel('Email').fill(admin);
  await consolePage.getByLabel('Mot de passe').fill('administrateur1');
  await consolePage.getByLabel("Code d'authentification").fill(totpCode(secret));
  await consolePage.getByRole('button', { name: 'Se connecter' }).click();
  await consolePage.getByRole('button', { name: 'Entreprises' }).click();
  const row = consolePage.getByRole('row', { name: new RegExp(email.replace('.', '\\.')) });
  await row.getByRole('button', { name: 'Gérer' }).click();
  await consolePage.getByLabel('Action').selectOption('suspend');
  await consolePage.getByLabel('Motif (journalisé)').fill('Test de suspension');
  await consolePage.getByRole('button', { name: 'Appliquer' }).click();
  await expect(row.getByText('Suspendu')).toBeVisible();
  await consoleApp.close();

  await page.getByRole('button', { name: 'Vérifier maintenant' }).click();
  await expect(page.getByRole('alert').first()).toContainText('suspendu');
  const blocked = await page.evaluate(() => (window as unknown as { api: { invoke: (c: string, i: unknown) => Promise<unknown> } }).api.invoke('customers.save', { id: null, name: 'A', phone: null, whatsapp: null, address: null }));
  expect(blocked).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  await app.close();
});

test('deux postes réels : le second rejoint l’entreprise, se connecte et voit les ventes du premier', async () => {
  const email = `${Date.now()}@multi.tg`;
  const nav = (page: import('@playwright/test').Page) => page.getByRole('navigation', { name: 'Navigation principale' });
  const first = await launchWithServer(userData, BASE, keys.publicKeyPem);
  await completeWizard(first.page, 'Commerce général', false);
  await first.page.getByLabel('Email').fill(email);
  await first.page.getByLabel('Mot de passe du compte').fill('motdepasse1');
  await first.page.getByRole('button', { name: "Démarrer l'essai gratuit" }).click();
  await nav(first.page).waitFor();

  await nav(first.page).getByRole('link', { name: 'Clients', exact: true }).click();
  await first.page.getByLabel('Nom', { exact: true }).fill('Client partagé');
  await first.page.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(first.page.getByRole('button', { name: 'Client partagé' })).toBeVisible();

  await nav(first.page).getByRole('link', { name: 'Sauvegardes' }).click();
  await first.page.getByRole('button', { name: 'Afficher le code' }).click();
  const code = (await first.page.getByTestId('recovery-code').textContent())!;
  await nav(first.page).getByRole('link', { name: 'Synchronisation' }).click();
  await first.page.getByRole('button', { name: 'Activer la synchronisation' }).click();
  await expect(first.page.getByTestId('pending')).toHaveText('0');

  const secondData = newUserData();
  const second = await launchWithServer(secondData, BASE, keys.publicKeyPem);
  await second.page.getByRole('button', { name: 'Rejoindre une entreprise existante' }).click();
  await second.page.getByLabel('Email du compte').fill(email);
  await second.page.getByLabel('Mot de passe du compte').fill('motdepasse1');
  await second.page.getByLabel('Code de récupération').fill(code);
  await second.page.getByRole('button', { name: 'Rejoindre' }).click();
  await expect(second.page.getByRole('heading', { name: 'Connexion' })).toBeVisible({ timeout: 20_000 });
  await second.page.getByLabel('Identifiant').fill('patron');
  await second.page.getByLabel('Mot de passe').fill('motdepasse');
  await second.page.getByRole('button', { name: 'Se connecter' }).click();
  await nav(second.page).getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(second.page.getByRole('button', { name: 'Client partagé' })).toBeVisible();

  // Le serveur ne détient rien de lisible.
  const dump = await run('npx', ['tsx', '-e', `
    import { PrismaPg } from '@prisma/adapter-pg';
    import { PrismaClient } from './src/generated/client';
    (async () => {
      const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
      const rows = await db.syncEnvelope.findMany({ orderBy: { seq: 'desc' }, take: 200 });
      console.log(JSON.stringify(rows.map((row) => row.ciphertext)));
      await db.$disconnect();
    })();
  `], { DATABASE_URL }, resolve('apps/api'));
  expect(dump.length).toBeGreaterThan(100);
  expect(dump).not.toContain('Client');

  await second.app.close();
  await first.app.close();
  rmSync(secondData, { recursive: true, force: true });
});
