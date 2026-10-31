import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut } from 'lucide-react';
import { roleLabels } from '@gestion/domain';
import { call } from '../lib/api';
import { useLicense } from '../lib/license';
import { useSession } from '../lib/session';
import { LicenseBanner } from '../features/license/LicenseBanner';
import { navigation, type NavItem } from './navigation';

const MORE_KEY = 'glotta.menu.plus';

function readMoreOpen(): boolean {
  try {
    return localStorage.getItem(MORE_KEY) === '1';
  } catch {
    return false;
  }
}

export function Layout() {
  const { pathname } = useLocation();
  const { session, can, refresh } = useSession();
  const { license } = useLicense();
  // Après expiration, les données restent consultables : les écrans ne sont masqués que pour une formule qui ne les inclut pas.
  const items = navigation.filter((item) => (!item.permission || can(item.permission)) && (!item.feature || !license || !license.canOperate || license.features.includes(item.feature)));
  // Comparaison exacte d'abord : /ventes ne doit pas être pris pour /vente.
  const current = items.find((item) => pathname === item.path) ?? items.find((item) => pathname.startsWith(`${item.path}/`));
  const wide = !['/systeme'].some((path) => pathname.startsWith(path));
  const [moreOpen, setMoreOpen] = useState(readMoreOpen);
  const toggleMore = () => {
    setMoreOpen(!moreOpen);
    try {
      localStorage.setItem(MORE_KEY, moreOpen ? '0' : '1');
    } catch {
      // Simple confort : sans stockage, le menu repart fermé.
    }
  };
  const showMore = moreOpen || Boolean(current && !current.daily);
  const others = items.filter((item) => !item.daily);
  const link = ({ path, label, icon: Icon }: NavItem) => (
    <NavLink
      key={path}
      to={path}
      className={({ isActive }) =>
        `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors ${
          isActive ? 'bg-selected font-medium text-selected-text' : 'text-muted hover:bg-canvas hover:text-text'
        }`
      }
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden />
      {label}
    </NavLink>
  );
  return (
    <div className="flex h-screen">
      <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="px-5 py-4 text-sm font-semibold tracking-tight">Glotta</div>
        <nav aria-label="Navigation principale" className="flex flex-col gap-0.5 overflow-y-auto px-2.5">
          {items.filter((item) => item.daily).map(link)}
          {others.length > 0 && (
            <button type="button" aria-expanded={showMore} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted hover:bg-canvas hover:text-text" onClick={toggleMore}>
              <ChevronDown size={16} strokeWidth={1.75} aria-hidden className={showMore ? 'rotate-180' : ''} />
              {showMore ? 'Moins' : 'Plus'}
            </button>
          )}
          {showMore && others.map(link)}
        </nav>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <p className="min-w-0 text-xs">
            <span className="block truncate font-medium">{session?.name}</span>
            <span className="text-muted">{session && roleLabels[session.role]}</span>
          </p>
          <button type="button" aria-label="Se déconnecter" className="rounded p-1.5 text-muted hover:text-text" onClick={() => void call('auth.logout', undefined).then(refresh)}>
            <LogOut size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <LicenseBanner />
        <div className={`mx-auto px-8 py-7 ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
          <h1 className="mb-5 text-xl font-semibold tracking-tight">{current?.label}</h1>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
