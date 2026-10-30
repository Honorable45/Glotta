import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join, resolve } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, safeStorage, session, shell } from 'electron';
import { channels, type Period, type ReportKind } from '@gestion/contracts';
import { checkIntegrity, createClient, migrate, recordChange } from '@gestion/db-local';
import { authorize, currentUserId, runWithRequest } from './core/session';
import { createAuthService } from './modules/auth.service';
import { createLicenseService } from './modules/license.service';
import { fileLicenseStore, loadDeviceIdentity } from './services/deviceIdentity';
import { createCatalogService } from './modules/catalog.service';
import { createCompanyService } from './modules/company.service';
import { createCustomersService } from './modules/customers.service';
import { createFinanceService } from './modules/finance.service';
import { createReportsService } from './modules/reports.service';
import { createRemindersService } from './modules/reminders.service';
import { createSalesService } from './modules/sales.service';
import { createStockService } from './modules/stock.service';
import { createSyncService } from './modules/sync.service';
import { createDispatcher } from './ipc/dispatcher';
import { createAppServices, ensureLocalDevice } from './services/appServices';
import { loadOrCreateKey, type SecretProtector } from './services/keystore';
import { readLogo } from './services/logo';
import { AppError } from './core/errors';
import { BACKUP_EXTENSION, normalizeCode, restoreBackup } from './services/backup';
import { createBackupManager } from './services/backupManager';
import { reportToCsv, reportToHtml, reportToXlsx } from './services/exporter';
import { htmlToPdf, printHtml } from './services/print';
import { buildReceiptHtml } from './services/receipt';

/** Le code est stocké sous sa forme d'origine ; la dérivation de clé l'uniformise elle-même. */
const normalizeRecovery = (code: string) => normalizeCode(code).match(/.{1,5}/g)?.join('-') ?? code;
function isNewerVersion(candidate: string, current: string): boolean {
  const parts = (version: string) => version.split('.').map(Number);
  const [a, b] = [parts(candidate), parts(current)];
  for (let index = 0; index < 3; index += 1) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

const advancedReports: ReportKind[] = ['salesByEmployee', 'margins', 'topProducts', 'cash'];
const devRendererUrl = process.env['ELECTRON_RENDERER_URL'];
const rendererFile = join(__dirname, '../renderer/index.html');

// Répertoire de données isolé pour les tests automatisés, jamais en production.
if (!app.isPackaged && process.env['GESTION_USER_DATA']) {
  app.setPath('userData', process.env['GESTION_USER_DATA']);
}

function protector(): SecretProtector {
  return {
    // Sous Linux sans trousseau, Electron retombe sur un mot de passe fixe : on le refuse.
    isAvailable: async () =>
      (await safeStorage.isAsyncEncryptionAvailable()) &&
      (process.platform !== 'linux' ||
        safeStorage.getSelectedStorageBackend() !== 'basic_text' ||
        // Playwright impose ce mode ; jamais accepté dans une version installée.
        (!app.isPackaged && process.env['GESTION_ALLOW_BASIC_STORAGE'] === '1')),
    encrypt: (text) => safeStorage.encryptStringAsync(text),
    decrypt: async (data) => (await safeStorage.decryptStringAsync(data)).result,
  };
}

function isTrustedUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (devRendererUrl) return parsed.origin === new URL(devRendererUrl).origin;
    return parsed.protocol === 'file:' && resolve(decodeURIComponent(parsed.pathname)) === resolve(rendererFile);
  } catch {
    return false;
  }
}

function hardenSession(): void {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url)) event.preventDefault();
  });
  if (devRendererUrl) void window.loadURL(devRendererUrl);
  else void window.loadFile(rendererFile);
}

function readPublicKey(): string | null {
  if (!app.isPackaged && process.env['GESTION_LICENSE_PUBLIC_KEY']) return process.env['GESTION_LICENSE_PUBLIC_KEY'];
  const path = app.isPackaged ? join(process.resourcesPath, 'license-public.pem') : resolve(__dirname, '../../resources/license-public.pem');
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

async function start(): Promise<void> {
  Menu.setApplicationMenu(null);
  hardenSession();

  const userData = app.getPath('userData');
  const appVersion = (!app.isPackaged && process.env['GESTION_TEST_APP_VERSION']) || app.getVersion();
  const license = createLicenseService({
    store: fileLicenseStore(join(userData, 'licence.json')),
    identity: await loadDeviceIdentity(join(userData, 'poste.key'), protector()),
    apiUrl: (!app.isPackaged && process.env['GESTION_API_URL']) || import.meta.env['MAIN_VITE_API_URL'] || null,
    publicKey: readPublicKey(),
    deviceName: hostname(),
    appVersion,
    testToken: app.isPackaged ? null : (process.env['GESTION_TEST_LICENSE'] ?? null),
  });
  license.load();

  // Avant toute migration : une grande version non couverte repart sans avoir modifié les données.
  if (!license.coversApp()) {
    await license.refresh().catch(() => undefined);
    if (!license.coversApp()) {
      const message = `Votre licence reste valide et vos données sont intactes, mais elle couvre les versions jusqu'à ${license.maxMajorVersion()}.x, alors que ce logiciel est en version ${appVersion}. Réinstallez une version couverte ou contactez votre vendeur pour obtenir cette version.`;
      console.error(message);
      if (!process.env['GESTION_TEST_APP_VERSION']) await dialog.showMessageBox({ type: 'warning', title: 'Version non couverte par votre licence', message });
      app.exit(3);
      return;
    }
  }

  const databasePath = join(userData, 'gestion.db');
  const keyPath = join(userData, 'gestion.key');
  const encryptionKey = await loadOrCreateKey(keyPath, databasePath, protector());
  const migrationsDir = app.isPackaged
    ? join(process.resourcesPath, 'migrations')
    : resolve(__dirname, '../../../../packages/db-local/prisma/migrations');

  const migration = migrate({
    databasePath,
    encryptionKey,
    migrationsDir,
    backupDir: join(userData, 'sauvegardes-migration'),
  });
  if (!checkIntegrity(databasePath, encryptionKey)) {
    throw new Error("La base de données est endommagée. Restaurez une sauvegarde avant de continuer.");
  }

  const db = createClient(databasePath, encryptionKey);
  const deviceId = await ensureLocalDevice(db);
  const services = createAppServices({
    db,
    deviceId,
    appVersion: app.getVersion(),
    appliedMigrations: migration.total,
    databasePath,
    encryptionKey,
  });

  const company = createCompanyService({ db, deviceId });

  const catalog = createCatalogService({ db, deviceId });
  const stock = createStockService({ db, deviceId });
  const customers = createCustomersService({ db, deviceId });
  const sales = createSalesService({ db, deviceId });

  const finance = createFinanceService({ db, deviceId });
  const reports = createReportsService({ db, deviceId });

  async function exportReport(kind: ReportKind, period: Period, format: 'csv' | 'xlsx' | 'pdf') {
    // Le CSV reste toujours possible : l'entreprise garde l'accès à ses données quelle que soit sa formule.
    if (format !== 'csv') license.requireFeature('export_files');
    const report = await reports.run(kind, period);
    const { currency, name } = await company.getCompany();
    const options = {
      title: 'Exporter le rapport',
      defaultPath: `${report.title}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    };
    const parent = BrowserWindow.getFocusedWindow();
    const { canceled, filePath } = await (parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options));
    if (canceled || !filePath) return { path: null };
    const label = `${new Date(period.from).toLocaleDateString('fr-FR')} au ${new Date(period.to).toLocaleDateString('fr-FR')}`;
    const content =
      format === 'csv'
        ? reportToCsv(report, currency)
        : format === 'xlsx'
          ? await reportToXlsx(report, currency)
          : await htmlToPdf(reportToHtml(report, currency, name, label));
    await writeFile(filePath, content);
    return { path: filePath };
  }

  const auth = createAuthService({ db, deviceId, maxUsers: () => license.limits().maxUsers });

  const reminders = createRemindersService({
    db,
    deviceId,
    // Seul WhatsApp peut être ouvert par ce service : l'adresse est construite côté processus principal.
    openUrl: (url) => shell.openExternal(url),
  });
  const backups = createBackupManager({ db, databasePath, encryptionKey, defaultFolder: join(userData, 'sauvegardes') });

  const sync = createSyncService({ db, deviceId, databasePath, encryptionKey, transport: () => license.syncTransport() });

  async function chooseBackupFolder() {
    const parent = BrowserWindow.getFocusedWindow();
    const options = { title: 'Dossier des sauvegardes', properties: ['openDirectory' as const, 'createDirectory' as const] };
    const { canceled, filePaths } = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
    const [path] = filePaths;
    return canceled || !path ? backups.status() : backups.setFolder(path);
  }

  async function restoreFromFile(code: string) {
    const parent = BrowserWindow.getFocusedWindow();
    const options = { title: 'Choisir une sauvegarde', properties: ['openFile' as const], filters: [{ name: 'Sauvegardes', extensions: [BACKUP_EXTENSION] }] };
    const { canceled, filePaths } = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
    const [path] = filePaths;
    if (canceled || !path) return { restored: false };
    await db.$disconnect();
    try {
      const restoredKey = await restoreBackup({ path, code, databasePath, asidePath: `${databasePath}.avant-restauration-${Date.now()}` });
      writeFileSync(keyPath, await protector().encrypt(restoredKey), { mode: 0o600 });
    } catch (error) {
      // La base n'a pas été touchée : la connexion se rouvrira toute seule à la prochaine requête.
      throw error;
    }
    setImmediate(() => { app.relaunch(); app.exit(0); });
    return { restored: true };
  }

  async function saveActivationRequest(request: string) {
    const parent = BrowserWindow.getFocusedWindow();
    const options = { title: "Enregistrer la demande d'activation", defaultPath: 'demande-activation.gcdemande', filters: [{ name: "Demande d'activation", extensions: ['gcdemande'] }] };
    const { canceled, filePath } = await (parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options));
    if (canceled || !filePath) return { path: null };
    await writeFile(filePath, request);
    return { path: filePath };
  }

  async function importLicenseFile() {
    const parent = BrowserWindow.getFocusedWindow();
    const options = { title: 'Choisir le fichier de licence', properties: ['openFile' as const], filters: [{ name: 'Fichier de licence', extensions: ['gclicence'] }] };
    const { canceled, filePaths } = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
    const [path] = filePaths;
    return canceled || !path ? license.state() : license.importToken(readFileSync(path, 'utf8'));
  }

  const notified = new Set<string>();
  async function notifyDueReminders() {
    if (!license.hasFeature('reminders') || !Notification.isSupported()) return;
    for (const reminder of await reminders.due()) {
      if (notified.has(reminder.id)) continue;
      notified.add(reminder.id);
      new Notification({ title: 'Rappel de paiement', body: `Relancer ${reminder.customerName} (échéance du ${reminder.dueDate})` }).show();
    }
  }

  async function pickLogo(): Promise<string | null> {
    const parent = BrowserWindow.getFocusedWindow();
    const options = {
      title: 'Choisir un logo',
      properties: ['openFile' as const],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }],
    };
    const result = await (parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options));
    const [path] = result.filePaths;
    return result.canceled || !path ? null : readLogo(path);
  }

  const dispatch = createDispatcher(
    {
      'system.getStatus': () => services.getStatus(),
      'settings.getTheme': () => services.getTheme(),
      'settings.setTheme': ({ theme }) => services.setTheme(theme),
      'setup.getState': () => company.getSetupState(),
      'setup.complete': async (input) => {
        const { ownerId } = await company.completeSetup(input);
        await auth.openSession(ownerId);
        return { completed: true };
      },
      'company.get': () => company.getCompany(),
      'company.update': (input) => company.updateCompany(input),
      'company.pickLogo': pickLogo,
      'categories.list': () => company.listCategories(),
      'categories.save': (input) => company.saveCategory(input),
      'categories.archive': ({ id }) => company.archiveCategory(id),
      'attributes.list': () => company.listAttributes(),
      'attributes.save': (input) => company.saveAttribute(input),
      'attributes.archive': ({ id }) => company.archiveAttribute(id),
      'units.list': () => company.listUnits(),
      'units.save': (input) => company.saveUnit(input),
      'units.archive': ({ id }) => company.archiveUnit(id),
      'paymentMethods.list': () => company.listPaymentMethods(),
      'paymentMethods.save': (input) => company.savePaymentMethod(input),
      'stockSettings.get': () => company.getStockSettings(),
      'stockSettings.save': (input) => company.saveStockSettings(input),
      'products.list': (input) => catalog.list(input),
      'products.get': ({ id }) => catalog.get(id),
      'products.save': (input) => catalog.save(input),
      'products.setArchived': ({ id, archived }) => catalog.setArchived(id, archived),
      'pos.search': ({ query }) => catalog.posSearch(query),
      'stock.move': (input) => stock.move(input),
      'stock.movements': ({ variantId }) => stock.movements(variantId),
      'stock.availableSerials': ({ variantId }) => stock.availableSerials(variantId),
      'inventory.current': () => stock.currentInventory(),
      'inventory.start': () => stock.startInventory(),
      'inventory.setCounted': ({ lineId, counted }) => stock.setCounted(lineId, counted),
      'inventory.close': () => stock.closeInventory(),
      'customers.list': ({ search }) => customers.list(search),
      'customers.get': ({ id }) => customers.get(id),
      'customers.save': (input) => customers.save(input),
      'customers.setArchived': ({ id, archived }) => customers.setArchived(id, archived),
      'sales.create': (input) => sales.create(input),
      'sales.list': ({ limit }) => sales.list(limit),
      'sales.get': ({ id }) => sales.detail(id),
      'sales.return': (input) => sales.returnItems(input),
      'sales.cancel': (input) => sales.cancel(input),
      'debts.list': (input) => finance.listDebts(input),
      'debts.pay': (input) => finance.payDebt(input),
      'debts.setDueDate': ({ debtId, dueDate }) => finance.setDueDate(debtId, dueDate),
      'expenseCategories.list': () => finance.listExpenseCategories(),
      'expenseCategories.save': (input) => finance.saveExpenseCategory(input),
      'expenses.list': (input) => finance.listExpenses(input),
      'expenses.create': (input) => finance.createExpense(input),
      'expenses.void': ({ id, reason }) => finance.voidExpense(id, reason),
      'cash.current': () => finance.currentCash(),
      'cash.open': ({ openingFloat }) => finance.openCash(openingFloat),
      'cash.move': (input) => finance.moveCash(input),
      'cash.close': (input) => finance.closeCash(input),
      'cash.history': ({ limit }) => finance.cashHistory(limit),
      'dashboard.get': (input) => reports.dashboard(input),
      'dashboard.getHidden': () => reports.getHidden(),
      'dashboard.setHidden': ({ hidden }) => reports.setHidden(hidden),
      'reports.run': ({ kind, period }) => {
        if (advancedReports.includes(kind)) license.requireFeature('advanced_reports');
        if (kind === 'salesByStore') license.requireFeature('consolidated');
        return reports.run(kind, period);
      },
      'reports.export': ({ kind, period, format }) => exportReport(kind, period, format),
      'auth.session': () => auth.session(),
      'auth.login': (input) => auth.login(input.login, input.password),
      'auth.logout': () => auth.logout(),
      'auth.changePassword': (input) => auth.changePassword(input.current, input.next),
      'users.list': () => auth.listUsers(),
      'users.save': (input) => auth.saveUser(input),
      'users.setDisabled': ({ id, disabled }) => auth.setDisabled(id, disabled),
      'users.resetPassword': ({ id, password }) => auth.resetPassword(id, password),
      'audit.list': ({ limit }) => auth.auditList(limit),
      'reminders.list': ({ includeDone }) => reminders.list(includeDone),
      'reminders.create': (input) => reminders.create(input),
      'reminders.whatsapp': ({ id }) => reminders.whatsapp(id),
      'reminders.markDone': ({ id }) => reminders.markDone(id),
      'debts.whatsapp': ({ debtId }) => reminders.openWhatsapp(debtId),
      'backup.status': () => backups.status(),
      'backup.create': () => backups.create(),
      'backup.revealCode': async () => {
        const code = await backups.recoveryCode();
        await db.$transaction((tx) => recordChange(tx, { deviceId, actorId: currentUserId(), action: 'backup.code.reveal', entityType: 'Setting', entityId: 'recovery', details: {}, sync: false }));
        return { code };
      },
      'backup.codeStatus': async () => ({ confirmed: await backups.codeConfirmed() }),
      'backup.confirmCode': async ({ code }) => {
        if (!(await backups.confirmCode(code))) throw new AppError('CONFLICT', 'Ce code ne correspond pas. Vérifiez ce que vous avez noté.');
        return { confirmed: true };
      },
      'backup.chooseFolder': () => chooseBackupFolder(),
      'backup.restore': ({ code }) => restoreFromFile(code),
      'sync.status': () => sync.status(),
      'sync.enable': async () => {
        await backups.recoveryCode();
        return sync.enable();
      },
      'sync.run': () => sync.run(),
      'sync.join': async ({ licenseKey, code }) => {
        // Refusé d'emblée si le poste contient déjà une entreprise, avant tout appel au serveur.
        if ((await company.getSetupState()).completed) throw new AppError('CONFLICT', 'Ce poste contient déjà une entreprise.');
        await license.activate(licenseKey);
        await sync.join(normalizeRecovery(code));
        // Saisi à la main sur ce poste : il est donc déjà noté.
        await backups.markCodeConfirmed();
        return { joined: true };
      },
      'sync.resolveConflict': ({ id }) => sync.resolveConflict(id),
      'stores.list': () => company.listStores(),
      'stores.save': (input) => company.saveStore(input, license.limits().maxStores),
      'stores.setCurrent': async ({ id }) => {
        await company.setCurrentStore(id);
        return company.listStores();
      },
      'system.checkUpdate': async () => {
        const latest = await license.latestRelease();
        if (!latest || !isNewerVersion(latest.version, app.getVersion())) return { available: false, covered: true, version: null, notes: null };
        // Une grande version vendue séparément est annoncée, sans inciter à installer ce qui ne démarrerait pas.
        if (!license.covers(latest.version)) return { available: true, covered: false, version: latest.version, notes: latest.notes };
        // Ouvert dans le navigateur : Windows vérifie la signature de l'installateur au lancement.
        if (latest.url.startsWith('https://')) await shell.openExternal(latest.url);
        return { available: true, covered: true, version: latest.version, notes: latest.notes };
      },
      'license.state': () => license.state(),
      'license.activate': ({ licenseKey }) => license.activate(licenseKey),
      'license.refresh': () => license.refresh(),
      'license.transfer': () => license.transfer(),
      'license.offlineRequest': ({ licenseKey }) => ({ request: license.offlineRequest(licenseKey) }),
      'license.saveRequest': ({ request }) => saveActivationRequest(request),
      'license.importToken': ({ token }) => license.importToken(token),
      'license.importFile': () => importLicenseFile(),
      'sales.print': async ({ saleId, format }) =>
        printHtml(buildReceiptHtml({ sale: await sales.detail(saleId), company: await company.getCompany(), format })),
    },
    isTrustedUrl,
    (access, channel) => {
      authorize(access);
      license.guard(channel);
    },
  );
  for (const channel of channels) {
    ipcMain.handle(channel, (event, input: unknown) => runWithRequest(() => dispatch(channel, event.senderFrame?.url, input)));
  }

  // Vérifie la licence au démarrage, sans bloquer si le réseau est absent.
  void license.refresh().catch(() => undefined);
  const licenseTimer = setInterval(() => void license.refresh().catch(() => undefined), 6 * 3_600_000);
  app.on('before-quit', () => clearInterval(licenseTimer));

  const logFailure = (task: string) => (error: unknown) => console.error(`[${task}]`, error);
  const runBackgroundTasks = () => {
    void backups.runIfDue().catch(logFailure('sauvegarde'));
    void notifyDueReminders().catch(logFailure('notifications'));
  };
  // Fréquent et sans effet si la synchronisation n'est pas activée ; les pannes restent visibles sur son écran.
  void sync.run();
  const syncTimer = setInterval(() => void sync.run(), 2 * 60_000);
  app.on('before-quit', () => clearInterval(syncTimer));
  runBackgroundTasks();
  const backgroundTimer = setInterval(runBackgroundTasks, 15 * 60_000);
  app.on('before-quit', () => clearInterval(backgroundTimer));
  app.on('before-quit', () => void db.$disconnect());
  createWindow();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [window] = BrowserWindow.getAllWindows();
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start).catch((error: unknown) => {
    console.error(error);
    dialog.showErrorBox(
      'Démarrage impossible',
      error instanceof Error ? error.message : 'Une erreur inconnue est survenue.',
    );
    app.exit(1);
  });
}
