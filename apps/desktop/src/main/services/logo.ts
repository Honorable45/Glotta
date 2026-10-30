import { readFile, stat } from 'node:fs/promises';
import { AppError } from '../core/errors';

const MAX_BYTES = 2 * 1024 * 1024;
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);

/** Se fie au contenu réel du fichier, pas à son extension. */
export async function readLogo(path: string): Promise<string> {
  if ((await stat(path)).size > MAX_BYTES) throw new AppError('INVALID_INPUT', 'Le logo ne doit pas dépasser 2 Mo.');
  const bytes = await readFile(path);
  const mime = bytes.subarray(0, PNG.length).equals(PNG)
    ? 'image/png'
    : bytes.subarray(0, JPEG.length).equals(JPEG)
      ? 'image/jpeg'
      : null;
  if (!mime) throw new AppError('INVALID_INPUT', 'Le logo doit être une image PNG ou JPEG.');
  return `data:${mime};base64,${bytes.toString('base64')}`;
}
