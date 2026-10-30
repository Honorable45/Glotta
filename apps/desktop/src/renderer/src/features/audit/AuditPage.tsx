import { Alert, Card, DataTable } from '@gestion/ui';
import { call } from '../../lib/api';
import { formatDateTime } from '../../lib/format';
import { useLoad } from '../../lib/useLoad';

export const actionLabels: Record<string, string> = {
  'auth.login': 'Connexion',
  'auth.login.failed': 'Connexion refusée',
  'auth.logout': 'Déconnexion',
  'auth.password.change': 'Mot de passe modifié',
  'user.create': 'Employé créé',
  'user.update': 'Employé modifié',
  'user.disable': 'Employé désactivé',
  'user.enable': 'Employé activé',
  'user.password.reset': 'Mot de passe réinitialisé',
  'setup.complete': 'Configuration initiale',
  'company.update': 'Entreprise modifiée',
  'sale.create': 'Vente',
  'sale.return': 'Retour',
  'sale.cancel': 'Annulation de vente',
  'debt.pay': 'Paiement de dette',
  'debt.setDueDate': 'Échéance modifiée',
  'expense.create': 'Dépense',
  'expense.void': 'Dépense annulée',
  'cash.open': 'Ouverture de caisse',
  'cash.close': 'Fermeture de caisse',
  'cash.in': 'Encaissement',
  'cash.out': 'Décaissement',
  'cash.withdrawal': 'Retrait',
  'stock.in': 'Entrée de stock',
  'stock.out': 'Sortie de stock',
  'inventory.start': 'Inventaire démarré',
  'inventory.close': 'Inventaire clôturé',
  'product.save': 'Produit enregistré',
  'product.archive': 'Produit archivé',
  'product.restore': 'Produit restauré',
  'customer.save': 'Client enregistré',
  'customer.archive': 'Client archivé',
  'settings.theme.update': 'Thème modifié',
  'stockSettings.save': 'Paramètres de stock',
  'category.save': 'Catégorie enregistrée',
  'category.archive': 'Catégorie archivée',
  'attribute.save': 'Caractéristique enregistrée',
  'attribute.archive': 'Caractéristique archivée',
  'unit.save': 'Unité enregistrée',
  'unit.archive': 'Unité archivée',
  'paymentMethod.save': 'Mode de paiement',
  'expenseCategory.save': 'Catégorie de dépense',
  'reminder.create': 'Rappel programmé',
  'reminder.whatsapp': 'WhatsApp ouvert',
  'reminder.done': 'Rappel effectué',
  'backup.code.reveal': 'Code de récupération affiché',
};

export function AuditPage() {
  const { data, error } = useLoad(() => call('audit.list', { limit: 300 }));
  return (
    <Card title="Dernières opérations">
      {error && <Alert>{error}</Alert>}
      <DataTable
        rows={data ?? []}
        rowKey={(row) => row.id}
        empty="Aucune opération."
        columns={[
          { header: 'Date', render: (row) => formatDateTime(row.occurredAt) },
          { header: 'Employé', render: (row) => row.actorName ?? 'Système' },
          { header: 'Opération', render: (row) => actionLabels[row.action] ?? row.action },
        ]}
      />
    </Card>
  );
}
