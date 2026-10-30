import { posix, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Vrai seulement si l'adresse désigne ce fichier local. La conversion dépend du système : `/C:/...` n'est pas un chemin Windows. */
export function isSameFileUrl(url: string, file: string, windows = process.platform === 'win32'): boolean {
  try {
    if (new URL(url).protocol !== 'file:') return false;
    const path = fileURLToPath(url, { windows });
    // Windows ne distingue pas la casse : la lettre du lecteur peut changer d'écriture entre les deux.
    return windows ? win32.resolve(path).toLowerCase() === win32.resolve(file).toLowerCase() : posix.resolve(path) === posix.resolve(file);
  } catch {
    return false;
  }
}
