import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useLicense } from '../../lib/license';
import { useSession } from '../../lib/session';
import { StoresPage } from './StoresPage';
import { AccountPage } from './AccountPage';
import { AppearancePage } from './AppearancePage';
import { AttributesPage } from './AttributesPage';
import { CategoriesPage } from './CategoriesPage';
import { CompanyPage } from './CompanyPage';
import { PaymentMethodsPage } from './PaymentMethodsPage';
import { StockSettingsPage } from './StockSettingsPage';
import { UnitsPage } from './UnitsPage';

const shared = [
  { path: 'entreprise', label: 'Entreprise', element: <CompanyPage /> },
  { path: 'categories', label: 'Catégories', element: <CategoriesPage /> },
  { path: 'caracteristiques', label: 'Caractéristiques', element: <AttributesPage /> },
  { path: 'unites', label: 'Unités', element: <UnitsPage /> },
  { path: 'paiements', label: 'Paiements', element: <PaymentMethodsPage /> },
  { path: 'stock', label: 'Stock', element: <StockSettingsPage /> },
];

const personal = [
  { path: 'apparence', label: 'Apparence', element: <AppearancePage /> },
  { path: 'compte', label: 'Mon compte', element: <AccountPage /> },
];

export function SettingsPage() {
  const { can } = useSession();
  const { license } = useLicense();
  const stores = can('manage_settings') && license?.features.includes('multi_store') ? [{ path: 'boutiques', label: 'Boutiques', element: <StoresPage /> }] : [];
  const tabs = [...(can('manage_settings') ? shared : []), ...stores, ...personal];
  return (
    <>
      <nav aria-label="Paramètres" className="mb-5 flex gap-5 border-b border-border">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={`/parametres/${tab.path}`}
            className={({ isActive }) =>
              `-mb-px border-b-2 pb-2.5 text-sm ${isActive ? 'border-primary font-medium text-text' : 'border-transparent text-muted hover:text-text'}`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Navigate to={`/parametres/${tabs[0]!.path}`} replace />} />
        {tabs.map((tab) => (
          <Route key={tab.path} path={tab.path} element={tab.element} />
        ))}
      </Routes>
    </>
  );
}
