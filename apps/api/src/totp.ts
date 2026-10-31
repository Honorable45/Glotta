import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret(): string {
  // 32 caractères, soit 160 bits : une longueur que toutes les applications décodent de la même façon.
  return [...randomBytes(32)].map((byte) => ALPHABET[byte % 32]).join('');
}

function decode(secret: string): Buffer {
  let bits = '';
  for (const char of secret) bits += ALPHABET.indexOf(char).toString(2).padStart(5, '0');
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => Number.parseInt(byte, 2)));
}

/** RFC 6238 : compatible avec les applications d'authentification courantes. */
export function totpCode(secret: string, time = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const hash = createHmac('sha1', decode(secret)).update(counter).digest();
  const offset = hash[hash.length - 1]! & 0xf;
  return String((hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

export function verifyTotp(secret: string, code: string, time = Date.now()): boolean {
  const given = Buffer.from(code.padEnd(6, ' '));
  return [-30_000, 0, 30_000].some((drift) => {
    const expected = Buffer.from(totpCode(secret, time + drift));
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
