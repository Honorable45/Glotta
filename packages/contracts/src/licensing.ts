import type { PlanFeature } from '@gestion/license/features';
import type { Channel } from './channels';

/**
 * Canaux qui modifient l'activité : bloqués quand l'abonnement ne permet plus d'opérer.
 * La consultation et l'export restent ouverts, conformément à l'engagement de ne jamais retenir les données.
 */
export const writeChannels: readonly Channel[] = [
  'products.save', 'products.setArchived', 'stock.move', 'inventory.start', 'inventory.setCounted', 'inventory.close',
  'customers.save', 'customers.setArchived', 'sales.create', 'sales.return', 'sales.cancel', 'debts.pay', 'debts.setDueDate', 'reminders.create', 'reminders.whatsapp', 'reminders.markDone', 'debts.whatsapp',
  'expenseCategories.save', 'expenses.create', 'expenses.void', 'cash.open', 'cash.move', 'cash.close',
  'stores.save', 'users.save', 'users.setDisabled', 'categories.save', 'categories.archive', 'attributes.save', 'attributes.archive',
  'units.save', 'units.archive', 'paymentMethods.save', 'stockSettings.save', 'company.update',
];

/** Fonctions réservées à certaines formules. */
export const channelFeatures: Partial<Record<Channel, PlanFeature>> = {
  'debts.setDueDate': 'advanced_debts',
  'stores.save': 'multi_store',
  'reminders.list': 'reminders',
  'reminders.create': 'reminders',
  'reminders.whatsapp': 'reminders',
  'reminders.markDone': 'reminders',
  'debts.whatsapp': 'reminders',
  'expenseCategories.list': 'expenses',
  'expenseCategories.save': 'expenses',
  'expenses.list': 'expenses',
  'expenses.create': 'expenses',
  'expenses.void': 'expenses',
  'cash.current': 'cash',
  'cash.open': 'cash',
  'cash.move': 'cash',
  'cash.close': 'cash',
  'cash.history': 'cash',
};
