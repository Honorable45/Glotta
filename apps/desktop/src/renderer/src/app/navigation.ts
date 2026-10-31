import type { Permission } from '@gestion/domain';
import { Activity, BarChart3, Boxes, KeyRound, BellRing, DatabaseBackup, RefreshCw, HandCoins, LayoutDashboard, Package, ReceiptText, ScrollText, Settings, ShoppingCart, UserCog, Users, Vault, Wallet, type LucideIcon } from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Toutes requises ; absent = tout utilisateur connecté. */
  permission?: Permission;
  /** Fonction réservée à certaines formules. */
  feature?: string;
  /** Usage de tous les jours : toujours visible. Le reste attend derrière « Plus ». */
  daily?: boolean;
}

/** Une entrée n'est ajoutée ici que lorsque son module fonctionne réellement. */
export const navigation: NavItem[] = [
  { path: '/vente', label: 'Vendre', icon: ShoppingCart, permission: 'sell', daily: true },
  { path: '/ventes', label: 'Mes ventes', icon: ReceiptText, permission: 'sell', daily: true },
  { path: '/produits', label: 'Produits', icon: Package, permission: 'manage_products', daily: true },
  { path: '/stock', label: 'Stock', icon: Boxes, permission: 'manage_stock', daily: true },
  { path: '/clients', label: 'Clients', icon: Users, daily: true },
  { path: '/dettes', label: 'Dettes', icon: HandCoins, permission: 'view_debts', daily: true },
  { path: '/tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard, permission: 'view_dashboard', daily: true },
  { path: '/rappels', label: 'Rappels', icon: BellRing, permission: 'view_debts', feature: 'reminders' },
  { path: '/depenses', label: 'Dépenses', icon: Wallet, permission: 'manage_expenses', feature: 'expenses' },
  { path: '/caisse', label: 'Caisse', icon: Vault, permission: 'manage_cash', feature: 'cash' },
  { path: '/rapports', label: 'Rapports', icon: BarChart3, permission: 'view_reports' },
  { path: '/employes', label: 'Employés', icon: UserCog, permission: 'manage_users' },
  { path: '/journal', label: "Journal d'activité", icon: ScrollText, permission: 'view_audit' },
  { path: '/sauvegardes', label: 'Sauvegardes', icon: DatabaseBackup, permission: 'manage_settings' },
  { path: '/synchronisation', label: 'Synchronisation', icon: RefreshCw, permission: 'manage_settings', feature: 'sync' },
  { path: '/licence', label: 'Licence', icon: KeyRound, permission: 'manage_settings' },
  { path: '/systeme', label: 'État du système', icon: Activity },
  { path: '/parametres', label: 'Paramètres', icon: Settings },
];
