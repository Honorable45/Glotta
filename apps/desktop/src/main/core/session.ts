import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission, Role } from '@gestion/domain';
import { effectivePermissions } from '@gestion/domain';
import { AppError } from './errors';

export interface SessionUser {
  id: string;
  name: string;
  login: string;
  role: Role;
  permissions: Permission[];
}

/** Session gardée dans le processus principal : le renderer ne détient aucun jeton à voler. */
let current: SessionUser | null = null;
const requests = new AsyncLocalStorage<{ user: SessionUser | null }>();

export function setSession(user: { id: string; name: string; login: string; role: Role; overrides: Partial<Record<Permission, boolean>> } | null) {
  current = user && {
    id: user.id,
    name: user.name,
    login: user.login,
    role: user.role,
    permissions: effectivePermissions(user.role, user.overrides),
  };
}

export const getSession = () => current;

/** Fige l'utilisateur pour toute la durée d'une requête, même si la session change entre-temps. */
export const runWithRequest = <T>(run: () => T): T => requests.run({ user: current }, run);

const active = () => requests.getStore()?.user ?? null;

export const currentUserId = () => active()?.id ?? null;

/** Hors requête IPC (tests des services, tâches internes), aucune restriction d'utilisateur ne s'applique. */
export const hasPermission = (permission: Permission) => {
  const store = requests.getStore();
  return store ? (store.user?.permissions.includes(permission) ?? false) : true;
};

export function requirePermission(permission: Permission) {
  if (!hasPermission(permission)) throw new AppError('FORBIDDEN', "Vous n'avez pas l'autorisation pour cette opération.");
}

export function authorize(access: 'public' | 'authenticated' | Permission) {
  if (access === 'public') return;
  if (!active()) throw new AppError('UNAUTHENTICATED', 'Veuillez vous connecter.');
  if (access !== 'authenticated') requirePermission(access);
}
