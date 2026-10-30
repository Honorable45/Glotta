import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { generateLicenseKeys } from '../packages/license/src/index';
import { totpCode } from '../apps/api/src/totp';
import { completeWizard, confirmRecoveryCode, launchWithServer, newUserData } from './helpers';

const PORT = 18_081;
const BASE = `http://127.0.0.1:${PORT}`;
const DATABASE_URL = 'postgresql://postgres:test@127.0.0.1:55432/gestion_test';
const keys = generateLicenseKeys();
let server: ChildProcess;
let userData: string;
let consoleApp: ElectronApplication;
let consolePage: Page;
let downloads: string;

function run(command: string, args: string[], env: Record<string, string>, cwd: string) {
  return new Promise<string>((done, fail) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env } });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('exit', (code) => (code === 0 ? done(output) : fail(new Error(output))));
  });
}

const section = (name: string) => consolePage.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name, exact: true }).click();

async function createEdition(name: string, price: string, options: { sync?: boolean; devices?: string } = {}) {
  await section('Éditions et tarifs');
  await consolePage.getByRole('button', { name: 'Nouvelle édition' }).click();
  await consolePage.getByLabel(/^Code/).fill(name.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  await consolePage.getByLabel("Nom de l'édition").fill(name);
  await consolePage.getByLabel('Prix de vente (FCFA)').fill(price);
  await consolePage.getByLabel('Ordinateurs par licence').fill(options.devices ?? '1');
  await consolePage.getByLabel('Utilisateurs').fill('5');
  await consolePage.getByRole('checkbox', { name: 'Caisse' }).check();
  if (options.sync) {
    await consolePage.getByRole('checkbox', { name: 'Synchronisation' }).check();
    await consolePage.getByLabel('Stockage de synchronisation (Mo)').fill('50');
  }
  await consolePage.getByRole('button', { name: "Enregistrer l'édition" }).click();
  await expect(consolePage.getByRole('cell', { name: new RegExp(name) })).toBeVisible();
}

/** Parcours complet du vendeur : client, vente en attente, paiement confirmé, clé. */
async function sell(customer: string, edition: string): Promise<string> {
  await section('Clients');
  await consolePage.getByRole('button', { name: 'Nouveau client' }).click();
  await consolePage.getByLabel('Nom du client').fill(customer);
  await consolePage.getByLabel('Téléphone').fill('+228 90 11 22 33');
  await consolePage.getByRole('button', { name: 'Enregistrer le client' }).click();
  await expect(consolePage.getByRole('button', { name: customer })).toBeVisible();

  await section('Ventes');
  await consolePage.getByRole('button', { name: 'Nouvelle vente' }).click();
  await consolePage.getByLabel(/^Client/).selectOption({ label: customer });
  await consolePage.getByLabel(/^Édition/).selectOption({ label: edition });
  await consolePage.getByRole('button', { name: 'Créer la vente' }).click();
  const row = consolePage.getByRole('row', { name: new RegExp(customer) });
  await expect(row.getByText('En attente')).toBeVisible();

  // Avant le paiement, aucune clé n'est disponible.
  await row.getByRole('button', { name: /^…/ }).click();
  await expect(consolePage.getByText('La clé sera disponible après confirmation du paiement.')).toBeVisible();
  await expect(consolePage.getByRole('button', { name: 'Afficher la clé' })).toHaveCount(0);
  await consolePage.getByRole('button', { name: 'Fermer' }).click();

  await section('Ventes');
  await row.getByRole('button', { name: 'Confirmer le paiement' }).click();
  await consolePage.getByLabel('Mode de paiement').fill('Mobile Money');
  await consolePage.getByLabel('Référence du paiement').fill('TX-778');
  await consolePage.getByRole('button', { name: "J'ai reçu le paiement" }).click();
  await expect(row.getByText('Payé')).toBeVisible();

  await row.getByRole('button', { name: /^…/ }).click();
  await consolePage.getByRole('button', { name: 'Afficher la clé' }).click();
  return (await consolePage.getByTestId('license-key').textContent())!;
}

/** Attend le fichier écrit par le téléchargement réel de la plateforme. */
async function downloaded(pattern: RegExp): Promise<string> {
  let name: string | undefined;
  await expect.poll(() => { name = readdirSync(downloads).find((file) => pattern.test(file) && statSync(join(downloads, file)).size > 0); return Boolean(name); }).toBe(true);
  return join(downloads, name!);
}

test.beforeAll(async () => {
  server = spawn('npx', ['tsx', 'src/server.ts'], {
    cwd: resolve('apps/api'),
    // Groupe de processus dédié : npx lance tsx, qui lance node, et tout doit s'arrêter ensemble.
    detached: true,
    env: { ...process.env, DATABASE_URL, LICENSE_PRIVATE_KEY: keys.privateKeyPem, PORT: String(PORT), ADMIN_DIST: resolve('apps/admin/dist') },
  });
  await expect.poll(() => fetch(`${BASE}/health`).then((response) => response.ok, () => false), { timeout: 30_000 }).toBe(true);

  downloads = mkdtempSync(join(tmpdir(), 'gestion-telechargements-'));
  const admin = `${Date.now()}@admin.tg`;
  const created = await run('npx', ['tsx', 'scripts/create-admin.ts', admin, 'administrateur1'], { DATABASE_URL }, resolve('apps/api'));
  const secret = /authentification : ([A-Z2-7]+)/.exec(created)![1]!;
  const { ELECTRON_RUN_AS_NODE: _ignored, ...env } = process.env;
  consoleApp = await electron.launch({ args: [resolve('e2e/console-shell.cjs')], env: { ...env, CONSOLE_URL: `${BASE}/console/`, DOWNLOAD_DIR: downloads } as Record<string, string> });
  consolePage = await consoleApp.firstWindow();
  await consolePage.getByLabel('Email').fill(admin);
  await consolePage.getByLabel('Mot de passe').fill('administrateur1');
  await consolePage.getByLabel("Code d'authentification").fill(totpCode(secret));
  await consolePage.getByRole('button', { name: 'Se connecter' }).click();
  await consolePage.getByRole('navigation', { name: 'Sections' }).waitFor();
});
test.afterAll(async () => {
  await consoleApp?.close();
  process.kill(-server.pid!);
  rmSync(downloads, { recursive: true, force: true });
});
test.beforeEach(() => { userData = newUserData(); });
test.afterEach(() => rmSync(userData, { recursive: true, force: true }));

const stamp = () => String(Date.now());

test('de bout en bout : vente manuelle, activation en ligne, reçu, suspension, transfert', async () => {
  const id = stamp();
  const edition = `Standard ${id}`;
  const customer = `Boutique ${id}`;
  await createEdition(edition, '150000');
  const key = await sell(customer, edition);
  expect(key).toMatch(/^GC-[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);

  const { app, page } = await launchWithServer(userData, BASE, keys.publicKeyPem);
  await completeWizard(page, 'Téléphonie', false);
  await page.getByLabel('Clé de licence').fill('GC-ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ');
  await page.getByRole('button', { name: 'Activer ce poste' }).click();
  await expect(page.getByRole('alert')).toContainText('inconnue');
  await page.getByLabel('Clé de licence').fill(key);
  await page.getByRole('button', { name: 'Activer ce poste' }).click();
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.waitFor();
  await nav.getByRole('link', { name: 'Licence' }).click();
  await expect(page.getByText('À vie, sans expiration')).toBeVisible();
  await expect(page.getByText(edition)).toBeVisible();

  // Le reçu est un vrai fichier PDF.
  await section('Ventes');
  const row = consolePage.getByRole('row', { name: new RegExp(customer) });
  await row.getByRole('button', { name: 'Reçu PDF' }).click();
  expect(readFileSync(await downloaded(/^R-\d{6}\.pdf$/)).subarray(0, 5).toString()).toBe('%PDF-');

  // Suspension depuis la plateforme : le poste l'apprend par réponse signée.
  await section('Licences');
  await consolePage.getByLabel('Rechercher une licence').fill(customer);
  const licenseRow = consolePage.getByRole('row', { name: new RegExp(customer) });
  await licenseRow.getByRole('button', { name: /^…/ }).click();
  await expect(consolePage.getByText('1 sur 1')).toBeVisible();
  await consolePage.getByRole('button', { name: 'Suspendre' }).click();
  await consolePage.getByLabel('Motif (journalisé)').fill('Test de suspension');
  await consolePage.getByRole('button', { name: 'Appliquer' }).click();
  await expect(licenseRow.getByText('Suspendue')).toBeVisible();

  await page.getByRole('button', { name: 'Vérifier maintenant' }).click();
  await expect(page.getByRole('alert').first()).toContainText('suspendue');
  const save = () => page.evaluate(() => (window as unknown as { api: { invoke: (c: string, i: unknown) => Promise<unknown> } }).api.invoke('customers.save', { id: null, name: 'A', phone: null, whatsapp: null, address: null }));
  expect(await save()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });

  await consolePage.getByRole('button', { name: 'Réactiver' }).click();
  await consolePage.getByLabel('Motif (journalisé)').fill('Situation régularisée');
  await consolePage.getByRole('button', { name: 'Appliquer' }).click();
  await expect(licenseRow.getByText('Active')).toBeVisible();
  await page.getByRole('button', { name: 'Vérifier maintenant' }).click();
  await expect(page.getByRole('status')).toContainText('vérifiée');
  expect(await save()).toMatchObject({ ok: true });

  // Transfert : la place se libère et le nouveau poste s'active.
  await page.getByRole('button', { name: 'Transférer vers un autre ordinateur' }).click();
  await page.getByRole('button', { name: 'Libérer ce poste' }).click();
  await expect(page.getByRole('heading', { name: 'Activation du logiciel' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Consulter mes données sans activer' })).toBeVisible();
  expect(await save()).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
  await app.close();

  const otherData = newUserData();
  const other = await launchWithServer(otherData, BASE, keys.publicKeyPem);
  await completeWizard(other.page, 'Téléphonie', false);
  await other.page.getByLabel('Clé de licence').fill(key);
  await other.page.getByRole('button', { name: 'Activer ce poste' }).click();
  await other.page.getByRole('navigation', { name: 'Navigation principale' }).waitFor();
  await other.app.close();
  rmSync(otherData, { recursive: true, force: true });

  await consolePage.getByRole('button', { name: 'Fermer' }).click();
  await section("Journal d'audit");
  await expect(consolePage.getByRole('cell', { name: 'Paiement confirmé' }).first()).toBeVisible();
});

test('mise à niveau vendue par la plateforme : le droit augmente seulement après paiement', async () => {
  const id = stamp();
  const customer = `Fidèle ${id}`;
  const first = `Version un ${id}`;
  const second = `Version deux ${id}`;
  await createEdition(first, '100000');
  await sell(customer, first);
  await expect(consolePage.getByText("jusqu'à 1.x")).toBeVisible();
  await consolePage.getByRole('button', { name: 'Fermer' }).click();

  await section('Éditions et tarifs');
  await consolePage.getByRole('button', { name: 'Nouvelle édition' }).click();
  await consolePage.getByLabel(/^Code/).fill(`V2${id}`);
  await consolePage.getByLabel("Nom de l'édition").fill(second);
  await consolePage.getByLabel('Prix de vente (FCFA)').fill('40000');
  await consolePage.getByLabel('Grande version couverte').fill('2');
  await consolePage.getByRole('button', { name: "Enregistrer l'édition" }).click();
  await expect(consolePage.getByRole('cell', { name: new RegExp(second) })).toBeVisible();

  await section('Ventes');
  await consolePage.getByRole('button', { name: 'Nouvelle vente' }).click();
  await consolePage.getByLabel(/^Client/).selectOption({ label: customer });
  await consolePage.getByLabel(/^Édition/).selectOption({ label: second });
  await consolePage.getByLabel(/^Type de vente/).selectOption({ index: 1 });
  await consolePage.getByRole('button', { name: 'Créer la vente' }).click();
  const row = consolePage.getByRole('row', { name: new RegExp(`${customer}.*${second}`) });
  await expect(row.getByText('Mise à niveau')).toBeVisible();
  await row.getByRole('button', { name: /^…/ }).click();
  await expect(consolePage.getByText("jusqu'à 1.x")).toBeVisible();
  await consolePage.getByRole('button', { name: 'Fermer' }).click();

  await section('Ventes');
  await row.getByRole('button', { name: 'Confirmer le paiement' }).click();
  await consolePage.getByLabel('Mode de paiement').fill('Espèces');
  await consolePage.getByRole('button', { name: "J'ai reçu le paiement" }).click();
  await expect(row.getByText('Payé')).toBeVisible();
  await row.getByRole('button', { name: /^…/ }).click();
  await expect(consolePage.getByText("jusqu'à 2.x")).toBeVisible();
  await consolePage.getByRole('button', { name: 'Fermer' }).click();
});

test('activation hors ligne complète, sans adresse de serveur sur le poste', async () => {
  const id = stamp();
  const edition = `Hors ligne ${id}`;
  const customer = `Client isolé ${id}`;
  await createEdition(edition, '90000');
  const key = await sell(customer, edition);
  await consolePage.getByRole('button', { name: 'Fermer' }).click();

  // Aucune adresse d'API : ce poste ne peut joindre aucun serveur.
  const { app, page } = await launchWithServer(userData, null, keys.publicKeyPem);
  await completeWizard(page, 'Téléphonie', false);
  await page.getByLabel('Clé de licence').fill(key);
  await page.getByRole('button', { name: 'Créer la demande' }).click();
  const request = (await page.getByTestId('offline-request').textContent())!;

  const requestPath = join(userData, 'demande.gcdemande');
  await app.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, requestPath);
  await page.getByRole('button', { name: 'Enregistrer dans un fichier' }).click();
  await expect(page.getByRole('status')).toContainText('demande.gcdemande');
  expect(readFileSync(requestPath, 'utf8')).toBe(request);

  await section('Licences');
  await consolePage.getByRole('button', { name: 'Activation hors ligne' }).click();
  await consolePage.getByLabel('Fichier de demande').setInputFiles(requestPath);
  await expect(consolePage.getByLabel("Demande d'activation")).toHaveValue(request);
  await consolePage.getByRole('button', { name: 'Générer la licence' }).click();
  await expect(consolePage.getByRole('status')).toContainText('activé');
  await consolePage.getByRole('button', { name: 'Télécharger le fichier de licence' }).click();
  const licensePath = await downloaded(/\.gclicence$/);
  await consolePage.getByRole('button', { name: 'Fermer' }).click();

  // Un code quelconque est refusé, le fichier signé est accepté.
  await page.getByLabel('Code de licence reçu').fill('faux-code-de-licence');
  await page.getByRole('button', { name: 'Valider le code' }).click();
  await expect(page.getByRole('alert')).toContainText('invalide');
  await app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, licensePath);
  await page.getByRole('button', { name: 'Importer un fichier de licence' }).click();
  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await nav.waitFor();
  await nav.getByRole('link', { name: 'Licence' }).click();
  await expect(page.getByText('À vie, sans expiration')).toBeVisible();
  await app.close();

  // Le fichier ne vaut rien sur un autre ordinateur.
  const otherData = newUserData();
  const other = await launchWithServer(otherData, null, keys.publicKeyPem);
  await completeWizard(other.page, 'Téléphonie', false);
  await other.app.evaluate(({ dialog }, target) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] }); }, licensePath);
  await other.page.getByRole('button', { name: 'Importer un fichier de licence' }).click();
  await expect(other.page.getByRole('alert')).toContainText('autre ordinateur');
  await other.app.close();
  rmSync(otherData, { recursive: true, force: true });
});

test('deux postes réels sur une licence multi-postes : le second rejoint et reçoit les données', async () => {
  const id = stamp();
  const edition = `Multi ${id}`;
  await createEdition(edition, '300000', { sync: true, devices: '2' });
  const key = await sell(`Réseau ${id}`, edition);
  await consolePage.getByRole('button', { name: 'Fermer' }).click();
  const nav = (page: Page) => page.getByRole('navigation', { name: 'Navigation principale' });
  const first = await launchWithServer(userData, BASE, keys.publicKeyPem);
  await completeWizard(first.page, 'Commerce général', false);
  await first.page.getByLabel('Clé de licence').fill(key);
  await first.page.getByRole('button', { name: 'Activer ce poste' }).click();
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
  await second.page.getByLabel('Clé de licence').fill(key);
  await second.page.getByLabel('Code de récupération').fill(code);
  await second.page.getByRole('button', { name: 'Rejoindre' }).click();
  await expect(second.page.getByRole('heading', { name: 'Connexion' })).toBeVisible({ timeout: 20_000 });
  await second.page.getByLabel('Identifiant').fill('patron');
  await second.page.getByLabel('Mot de passe').fill('motdepasse');
  await second.page.getByRole('button', { name: 'Se connecter' }).click();
  // Le code a été saisi pour rejoindre : il n'est pas redemandé.
  await expect(second.page.getByTestId('first-recovery-code')).toHaveCount(0);
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

test('plateforme responsive : aucun défilement horizontal de la page sur téléphone', async () => {
  await consolePage.setViewportSize({ width: 375, height: 700 });
  await expect.poll(() => consolePage.evaluate(() => window.innerWidth)).toBe(375);
  const sections = ['Tableau de bord', 'Clients', 'Ventes', 'Licences', 'Activations', 'Éditions et tarifs', 'Assistance', 'Versions', "Journal d'audit", 'Journaux techniques', 'Paramètres'];
  for (const name of sections) {
    await consolePage.getByRole('button', { name: 'Menu' }).click();
    await section(name);
    await expect(consolePage.locator('header p')).toHaveText(name);
    await consolePage.waitForTimeout(150);
    const overflow = await consolePage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, name).toBeLessThanOrEqual(0);
  }
  await consolePage.setViewportSize({ width: 1280, height: 800 });
});
