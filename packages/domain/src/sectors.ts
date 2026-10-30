export type AttributeType = 'TEXT' | 'NUMBER' | 'SELECT' | 'DATE' | 'BOOLEAN' | 'MONEY';

export interface AttributeTemplate {
  name: string;
  type: AttributeType;
  options?: string[];
  required?: boolean;
  /** Noms des catégories concernées ; absent = toutes. */
  categories?: string[];
}

export interface SectorTemplate {
  key: string;
  label: string;
  categories: string[];
  units: { name: string; symbol: string; allowsDecimal: boolean }[];
  attributes: AttributeTemplate[];
}

const PIECE = { name: 'Pièce', symbol: 'pce', allowsDecimal: false };
const KILO = { name: 'Kilogramme', symbol: 'kg', allowsDecimal: true };
const LITRE = { name: 'Litre', symbol: 'L', allowsDecimal: true };
const METRE = { name: 'Mètre', symbol: 'm', allowsDecimal: true };
const BRAND: AttributeTemplate = { name: 'Marque', type: 'TEXT' };
const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

/** Points de départ modifiables : aucun comportement du logiciel ne dépend du secteur. */
export const sectorTemplates: SectorTemplate[] = [
  { key: 'general', label: 'Commerce général', categories: ['Divers'], units: [PIECE, KILO, LITRE], attributes: [BRAND] },
  {
    key: 'phones',
    label: 'Téléphonie',
    categories: ['Téléphones', 'Accessoires'],
    units: [PIECE],
    attributes: [
      BRAND,
      { name: 'Modèle', type: 'TEXT' },
      { name: 'RAM', type: 'SELECT', options: ['2 Go', '4 Go', '6 Go', '8 Go', '12 Go'], categories: ['Téléphones'] },
      { name: 'Stockage', type: 'SELECT', options: ['32 Go', '64 Go', '128 Go', '256 Go', '512 Go'], categories: ['Téléphones'] },
      { name: 'Couleur', type: 'TEXT' },
      { name: 'Garantie (mois)', type: 'NUMBER' },
    ],
  },
  {
    key: 'clothing',
    label: 'Vêtements',
    categories: ['Vêtements', 'Chaussures'],
    units: [PIECE],
    attributes: [
      BRAND,
      { name: 'Taille', type: 'SELECT', options: SIZES, categories: ['Vêtements'] },
      { name: 'Pointure', type: 'NUMBER', categories: ['Chaussures'] },
      { name: 'Couleur', type: 'TEXT' },
      { name: 'Matière', type: 'TEXT' },
    ],
  },
  {
    key: 'food',
    label: 'Alimentation',
    categories: ['Épicerie', 'Boissons', 'Produits frais'],
    units: [PIECE, KILO, LITRE],
    attributes: [
      BRAND,
      { name: 'Poids', type: 'TEXT' },
      { name: 'Date de péremption', type: 'DATE' },
      { name: 'Numéro de lot', type: 'TEXT' },
    ],
  },
  {
    key: 'hardware',
    label: 'Quincaillerie',
    categories: ['Outillage', 'Matériaux', 'Électricité'],
    units: [PIECE, KILO, METRE],
    attributes: [BRAND, { name: 'Dimensions', type: 'TEXT' }],
  },
  {
    key: 'electronics',
    label: 'Électronique',
    categories: ['Électroménager', 'Image et son', 'Informatique'],
    units: [PIECE],
    attributes: [BRAND, { name: 'Modèle', type: 'TEXT' }, { name: 'Garantie (mois)', type: 'NUMBER' }],
  },
  {
    key: 'cosmetics',
    label: 'Cosmétiques',
    categories: ['Soins', 'Maquillage', 'Parfums'],
    units: [PIECE],
    attributes: [BRAND, { name: 'Contenance', type: 'TEXT' }, { name: 'Date de péremption', type: 'DATE' }],
  },
  { key: 'other', label: 'Autre', categories: [], units: [PIECE], attributes: [] },
];

export const defaultPaymentMethods = ['Espèces', 'TMoney', 'Flooz', 'Carte bancaire'];

export const supportedCurrencies = [
  { code: 'XOF', label: 'Franc CFA (XOF)' },
  { code: 'XAF', label: 'Franc CFA (XAF)' },
  { code: 'GNF', label: 'Franc guinéen (GNF)' },
  { code: 'EUR', label: 'Euro (EUR)' },
  { code: 'USD', label: 'Dollar américain (USD)' },
];
