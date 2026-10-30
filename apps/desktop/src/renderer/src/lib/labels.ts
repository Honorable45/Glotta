import type { AttributeType } from '@gestion/domain';

export const attributeTypeLabels: Record<AttributeType, string> = {
  TEXT: 'Texte',
  NUMBER: 'Nombre',
  SELECT: 'Liste déroulante',
  DATE: 'Date',
  BOOLEAN: 'Case à cocher',
  MONEY: 'Valeur monétaire',
};
