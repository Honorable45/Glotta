import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../core/errors';
import { createDispatcher, type Handlers } from './dispatcher';

const status = {
  appVersion: '1',
  deviceId: 'd',
  appliedMigrations: 1,
  databaseEncrypted: true,
  integrityOk: true,
  auditChainOk: true,
  auditEntries: 0,
  pendingSyncEvents: 0,
};

function setup(overrides: Partial<Handlers> = {}) {
  const setTheme = vi.fn(async ({ theme }: { theme: 'system' | 'light' | 'dark' }) => theme);
  const handlers = {
    'system.getStatus': () => status,
    'settings.getTheme': () => 'system',
    'settings.setTheme': setTheme,
    ...overrides,
  } as Handlers;
  const dispatch = createDispatcher(handlers, (url) => url === 'app://ok');
  return { dispatch, setTheme };
}

describe('dispatcher IPC', () => {
  it('traite une requête valide', async () => {
    const { dispatch } = setup();
    expect(await dispatch('settings.setTheme', 'app://ok', { theme: 'dark' })).toEqual({ ok: true, data: 'dark' });
  });
  it('rejette une origine inconnue avant tout traitement', async () => {
    const { dispatch, setTheme } = setup();
    const result = await dispatch('settings.setTheme', 'https://attaque', { theme: 'dark' });
    expect(result).toMatchObject({ ok: false, error: { code: 'FORBIDDEN' } });
    expect(setTheme).not.toHaveBeenCalled();
  });
  it('rejette les canaux inconnus, y compris hérités de Object', async () => {
    const { dispatch } = setup();
    for (const channel of ['db.drop', 'constructor', '__proto__']) {
      expect(await dispatch(channel, 'app://ok', undefined)).toMatchObject({ ok: false, error: { code: 'UNKNOWN_CHANNEL' } });
    }
  });
  it('rejette les entrées invalides ou contenant des champs en trop', async () => {
    const { dispatch, setTheme } = setup();
    for (const input of [undefined, { theme: 'rose' }, { theme: 'dark', admin: true }]) {
      expect(await dispatch('settings.setTheme', 'app://ok', input)).toMatchObject({ ok: false, error: { code: 'INVALID_INPUT' } });
    }
    expect(setTheme).not.toHaveBeenCalled();
  });
  it('ne divulgue pas le détail des erreurs internes', async () => {
    const { dispatch } = setup({ 'system.getStatus': () => { throw new Error('/chemin/secret'); } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await dispatch('system.getStatus', 'app://ok', undefined);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(result).toMatchObject({ ok: false, error: { code: 'INTERNAL' } });
    spy.mockRestore();
  });
  it('transmet le message des erreurs métier', async () => {
    const { dispatch } = setup({ 'settings.getTheme': () => { throw new AppError('FORBIDDEN', 'Accès refusé.'); } });
    expect(await dispatch('settings.getTheme', 'app://ok', undefined)).toEqual({
      ok: false,
      error: { code: 'FORBIDDEN', message: 'Accès refusé.' },
    });
  });
});
