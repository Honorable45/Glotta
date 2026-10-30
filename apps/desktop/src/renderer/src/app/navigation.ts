import type { Permission } from '@gestion/domain';
import { Activity, BarChart3, Boxes, CreditCard, BellRing, DatabaseBackup, RefreshCw, HandCoins, LayoutDashboard, Package, ReceiptText, ScrollText, Settings, ShoppingCart, UserCog, Users, Vault, Wallet, type LucideIcon } from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Toutes requises ; absent = tout utilisateur connecté. */
  permission?: Permission;
  /** Fonction réservée à certaines formules. */
  feature?: string;
}

/** Une entrée n'est ajoutée ici que lorsque son module fonctionne réellement. */
export const navigation: NavItem[] = [
  { path: '/tableau-de-bord', label: 'Tableau de bord', icon: LayoutDashboard, permission: 'view_dashboard' },
  { path: '/vente', label: 'Vente', icon: ShoppingCart, permission: 'sell' },
  { path: '/ventes', label: 'Ventes', icon: ReceiptText, permission: 'sell' },
  { path: '/produits', label: 'Produits', icon: Package, permission: 'manage_products' },
  { path: '/stock', label: 'Stock', icon: Boxes, permission: 'manage_stock' },
  { path: '/clients', label: 'Clients', icon: Users },
  { path: '/dettes', label: 'Dettes', icon: HandCoins, permission: 'view_debts' },
  { path: '/rappels', label: 'Rappels', icon: BellRing, permission: 'view_debts', feature: 'reminders' },
  { path: '/depenses', label: 'Dépenses', icon: Wallet, permission: 'manage_expenses', feature: 'expenses' },
  { path: '/caisse', label: 'Caisse', icon: Vault, permission: 'manage_cash', feature: 'cash' },
  { path: '/rapports', label: 'Rapports', icon: BarChart3, permission: 'view_reports' },
  { path: '/employes', label: 'Employés', icon: UserCog, permission: 'manage_users' },
  { path: '/journal', label: "Journal d'activité", icon: ScrollText, permission: 'view_audit' },
  { path: '/sauvegardes', label: 'Sauvegardes', icon: DatabaseBackup, permission: 'manage_settings' },
  { path: '/synchronisation', label: 'Synchronisation', icon: RefreshCw, permission: 'manage_settings' },
  { path: '/abonnement', label: 'Abonnement', icon: CreditCard, permission: 'manage_settings' },
  { path: '/systeme', label: 'État du système', icon: Activity },
  { path: '/parametres', label: 'Paramètres', icon: Settings },
];
