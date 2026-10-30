export const permissionLabels = {
  sell: 'Réaliser des ventes',
  discount: 'Accorder des remises',
  edit_prices: 'Modifier les prix',
  cancel_sale: 'Annuler et retourner des ventes',
  view_debts: 'Consulter les dettes',
  collect_debts: 'Encaisser les dettes',
  view_profit: 'Consulter les marges et bénéfices',
  view_dashboard: 'Consulter le tableau de bord',
  view_reports: 'Consulter les rapports',
  export_reports: 'Exporter les rapports',
  manage_products: 'Gérer les produits',
  manage_stock: 'Gérer le stock',
  manage_customers: 'Gérer les clients',
  manage_expenses: 'Gérer les dépenses',
  manage_cash: 'Gérer la caisse',
  manage_settings: 'Modifier la configuration',
  manage_users: 'Gérer les employés',
  view_audit: "Consulter le journal d'activité",
} as const;

export type Permission = keyof typeof permissionLabels;
export const allPermissions = Object.keys(permissionLabels) as Permission[];

export const roleLabels = {
  OWNER: 'Propriétaire',
  ADMIN: 'Administrateur',
  MANAGER: 'Responsable',
  CASHIER: 'Caissier',
  SELLER: 'Vendeur',
  STOCK: 'Gestionnaire de stock',
} as const;

export type Role = keyof typeof roleLabels;

const rolePermissions: Record<Role, Permission[]> = {
  OWNER: allPermissions,
  ADMIN: allPermissions,
  MANAGER: allPermissions.filter((permission) => !['manage_users', 'manage_settings'].includes(permission)),
  CASHIER: ['sell', 'discount', 'view_debts', 'collect_debts', 'manage_cash', 'manage_customers'],
  SELLER: ['sell', 'manage_customers'],
  STOCK: ['manage_products', 'manage_stock'],
};

/** Le propriétaire garde toujours tous les droits : personne ne peut verrouiller l'entreprise. */
export function effectivePermissions(role: Role, overrides: Partial<Record<Permission, boolean>>): Permission[] {
  if (role === 'OWNER') return allPermissions;
  return allPermissions.filter((permission) => overrides[permission] ?? rolePermissions[role].includes(permission));
}
