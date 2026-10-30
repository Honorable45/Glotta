import { v7 } from 'uuid';

/** Identifiant triable par date, générable hors ligne sans collision entre postes. */
export const newId = (): string => v7();
