export const planFeatures = ['advanced_debts', 'reminders', 'expenses', 'cash', 'advanced_reports', 'export_files', 'multi_store', 'consolidated', 'advanced_permissions'] as const;
export type PlanFeature = (typeof planFeatures)[number];
