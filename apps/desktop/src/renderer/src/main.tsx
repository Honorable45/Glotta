import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './app/Layout';
import { ActivationPage } from './features/license/ActivationPage';
import { LicensePage } from './features/license/LicensePage';
import { RecoveryGate } from './features/backup/RecoveryGate';
import { LicenseProvider, useLicense } from './lib/license';
import { BackupPage } from './features/backup/BackupPage';
import { RemindersPage } from './features/reminders/RemindersPage';
import { SyncPage } from './features/sync/SyncPage';
import { AuditPage } from './features/audit/AuditPage';
import { LoginPage } from './features/auth/LoginPage';
import { UsersPage } from './features/users/UsersPage';
import { SessionProvider, useSession } from './lib/session';
import { navigation } from './app/navigation';
import { CashPage } from './features/cash/CashPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { DebtsPage } from './features/debts/DebtsPage';
import { ExpensesPage } from './features/expenses/ExpensesPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { CustomersPage } from './features/customers/CustomersPage';
import { PosPage } from './features/pos/PosPage';
import { ProductsPage } from './features/products/ProductsPage';
import { SalesPage } from './features/sales/SalesPage';
import { StockPage } from './features/stock/StockPage';
import { SettingsPage } from './features/settings/SettingsPage';
import { SetupGate } from './features/setup/SetupGate';
import { SystemPage } from './features/system/SystemPage';
import { ThemeProvider } from './lib/theme';
import './styles.css';

function App() {
  const { session, loaded } = useSession();
  if (!loaded) return null;
  if (!session) return <LoginPage />;
  return (
    <LicenseProvider>
      <RecoveryGate>
        <Licensed />
      </RecoveryGate>
    </LicenseProvider>
  );
}

function Licensed() {
  const { can } = useSession();
  const { license } = useLicense();
  const [browsing, setBrowsing] = useState(false);
  if (!license) return null;
  // La consultation reste toujours possible : l'activation ne retient jamais les données.
  if (license.status === 'NONE' && !browsing) return <ActivationPage onBrowse={() => setBrowsing(true)} />;
  const home = navigation.find((item) => !item.permission || can(item.permission))?.path ?? '/systeme';
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to={home} replace />} />
          <Route path="/tableau-de-bord" element={<DashboardPage />} />
          <Route path="/vente" element={<PosPage />} />
          <Route path="/dettes" element={<DebtsPage />} />
          <Route path="/depenses" element={<ExpensesPage />} />
          <Route path="/caisse" element={<CashPage />} />
          <Route path="/rapports" element={<ReportsPage />} />
          <Route path="/ventes" element={<SalesPage />} />
          <Route path="/produits" element={<ProductsPage />} />
          <Route path="/stock" element={<StockPage />} />
          <Route path="/clients" element={<CustomersPage />} />
          <Route path="/employes" element={<UsersPage />} />
          <Route path="/journal" element={<AuditPage />} />
          <Route path="/rappels" element={<RemindersPage />} />
          <Route path="/sauvegardes" element={<BackupPage />} />
          <Route path="/synchronisation" element={<SyncPage />} />
          <Route path="/licence" element={<LicensePage />} />
          <Route path="/systeme" element={<SystemPage />} />
          <Route path="/parametres/*" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to={home} replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <SessionProvider>
        <SetupGate>
          <App />
        </SetupGate>
      </SessionProvider>
    </ThemeProvider>
  </StrictMode>,
);
