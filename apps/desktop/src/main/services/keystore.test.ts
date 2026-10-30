import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateKey, type SecretProtector } from './keystore';

const protector: SecretProtector = {
  isAvailable: async () => true,
  encrypt: async (text) => Buffer.from(text).reverse(),
  decrypt: async (data) => Buffer.from(data).reverse().toString(),
};

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gestion-key-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('clé de base', () => {
  it('crée une clé stable, jamais écrite en clair', async () => {
    const key = await loadOrCreateKey(join(dir, 'k'), join(dir, 'db'), protector);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(dir, 'k')).toString()).not.toContain(key);
    expect(await loadOrCreateKey(join(dir, 'k'), join(dir, 'db'), protector)).toBe(key);
  });
  it('refuse de remplacer la clé d’une base existante', async () => {
    writeFileSync(join(dir, 'db'), 'x');
    await expect(loadOrCreateKey(join(dir, 'k'), join(dir, 'db'), protector)).rejects.toThrow(/introuvable/);
  });
  it('refuse de fonctionner sans stockage sécurisé', async () => {
    await expect(loadOrCreateKey(join(dir, 'k'), join(dir, 'db'), { ...protector, isAvailable: async () => false })).rejects.toThrow(/indisponible/);
  });
});
