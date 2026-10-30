import type { AuditEntry, Session, UserInput, UserItem } from '@gestion/contracts';
import { recordChange } from '@gestion/db-local';
import { newId, type Permission, type Role } from '@gestion/domain';
import { AppError } from '../core/errors';
import { hashPassword, verifyPassword } from '../core/password';
import { getSession, setSession } from '../core/session';
import { logger, type Context } from './commerce.shared';

const MAX_ATTEMPTS = 5;
const LOCK_MS = 60_000;

const parseOverrides = (text: string) => JSON.parse(text) as Partial<Record<Permission, boolean>>;

export function createAuthService({ db, deviceId, maxUsers = () => null }: Context & { maxUsers?: () => number | null }) {
  const log = logger(deviceId);
  const failures = new Map<string, { count: number; until: number }>();
  // Coût identique pour un identifiant inconnu : le temps de réponse ne révèle pas qui existe.
  const decoy = hashPassword(newId());

  const toItem = (row: { id: string; name: string; login: string; role: string; overrides: string; disabledAt: Date | null }): UserItem => ({
    id: row.id,
    name: row.name,
    login: row.login,
    role: row.role as Role,
    overrides: parseOverrides(row.overrides),
    disabled: row.disabledAt !== null,
  });

  function sessionView(): Session | null {
    const session = getSession();
    return session ? { ...session } : null;
  }

  const audit = (action: string, entityId: string, actorId: string | null, details: Record<string, unknown>) =>
    db.$transaction((tx) => recordChange(tx, { deviceId, actorId, action, entityType: 'User', entityId, details, sync: false }));

  async function assertUserSlot() {
    const limit = maxUsers();
    if (limit !== null && (await db.user.count({ where: { disabledAt: null } })) >= limit) {
      throw new AppError('CONFLICT', `Votre formule est limitée à ${limit} utilisateur(s). Changez de formule ou désactivez un compte.`);
    }
  }

  async function assertAnotherOwner(id: string) {
    const owners = await db.user.count({ where: { role: 'OWNER', disabledAt: null, id: { not: id } } });
    if (owners === 0) throw new AppError('CONFLICT', 'Il doit rester au moins un propriétaire actif.');
  }

  return {
    session: async () => sessionView(),

    async openSession(id: string) {
      const user = await db.user.findUniqueOrThrow({ where: { id } });
      setSession({ ...user, role: user.role as Role, overrides: parseOverrides(user.overrides) });
    },

    async login(login: string, password: string): Promise<Session | null> {
      const key = login.trim().toLowerCase();
      const failure = failures.get(key);
      if (failure && failure.until > Date.now()) {
        throw new AppError('FORBIDDEN', 'Trop de tentatives. Réessayez dans une minute.');
      }
      const user = await db.user.findFirst({ where: { login: { equals: login.trim() } } });
      const valid = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, await decoy);
      if (!user || !valid || user.disabledAt) {
        const count = (failure?.count ?? 0) + 1;
        failures.set(key, count >= MAX_ATTEMPTS ? { count: 0, until: Date.now() + LOCK_MS } : { count, until: 0 });
        await audit('auth.login.failed', user?.id ?? 'inconnu', null, { login: login.slice(0, 40) });
        // Message unique : il ne dit pas si l'identifiant existe.
        throw new AppError('FORBIDDEN', 'Identifiant ou mot de passe incorrect.');
      }
      failures.delete(key);
      setSession({ ...user, role: user.role as Role, overrides: parseOverrides(user.overrides) });
      await audit('auth.login', user.id, user.id, {});
      return sessionView();
    },

    async logout() {
      const session = getSession();
      setSession(null);
      if (session) await audit('auth.logout', session.id, session.id, {});
    },

    async changePassword(current: string, next: string) {
      const session = getSession();
      if (!session) throw new AppError('UNAUTHENTICATED', 'Veuillez vous connecter.');
      const user = await db.user.findUniqueOrThrow({ where: { id: session.id } });
      if (!(await verifyPassword(current, user.passwordHash))) throw new AppError('FORBIDDEN', 'Mot de passe actuel incorrect.');
      await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
      await audit('auth.password.change', user.id, user.id, {});
    },

    async listUsers(): Promise<UserItem[]> {
      return (await db.user.findMany({ orderBy: { name: 'asc' } })).map(toItem);
    },

    async saveUser(input: UserInput): Promise<UserItem> {
      const session = getSession();
      const existing = input.id ? await db.user.findUnique({ where: { id: input.id } }) : null;
      if (input.id && !existing) throw new AppError('NOT_FOUND', 'Employé introuvable.');
      // Seul un propriétaire peut créer, modifier ou retirer un propriétaire.
      if ((input.role === 'OWNER' || existing?.role === 'OWNER') && session?.role !== 'OWNER') {
        throw new AppError('FORBIDDEN', 'Seul un propriétaire peut gérer ce compte.');
      }
      if (existing?.role === 'OWNER' && input.role !== 'OWNER') await assertAnotherOwner(existing.id);
      if (!existing) await assertUserSlot();
      if (!existing && !input.password) throw new AppError('INVALID_INPUT', 'Indiquez un mot de passe.');
      const taken = await db.user.findFirst({ where: { login: input.login, id: { not: input.id ?? '' } } });
      if (taken) throw new AppError('CONFLICT', `L'identifiant ${input.login} est déjà utilisé.`);

      const id = input.id ?? newId();
      const data = { name: input.name, login: input.login, role: input.role, overrides: JSON.stringify(input.overrides) };
      const passwordHash = input.password ? await hashPassword(input.password) : null;
      const row = await db.$transaction(async (tx) => {
        const saved = existing
          ? await tx.user.update({ where: { id }, data })
          : await tx.user.create({ data: { id, ...data, passwordHash: passwordHash! } });
        await log(tx, existing ? 'user.update' : 'user.create', 'User', id, { name: input.name, role: input.role, overrides: input.overrides });
        return saved;
      });
      // Un changement sur soi-même s'applique tout de suite.
      if (session?.id === id) setSession({ ...row, role: row.role as Role, overrides: parseOverrides(row.overrides) });
      return toItem(row);
    },

    async setDisabled(id: string, disabled: boolean) {
      const session = getSession();
      const user = await db.user.findUnique({ where: { id } });
      if (!user) throw new AppError('NOT_FOUND', 'Employé introuvable.');
      if (id === session?.id) throw new AppError('CONFLICT', 'Vous ne pouvez pas désactiver votre propre compte.');
      if (user.role === 'OWNER' && session?.role !== 'OWNER') throw new AppError('FORBIDDEN', 'Seul un propriétaire peut gérer ce compte.');
      if (user.role === 'OWNER' && disabled) await assertAnotherOwner(id);
      if (!disabled && user.disabledAt) await assertUserSlot();
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { disabledAt: disabled ? new Date() : null } });
        await log(tx, disabled ? 'user.disable' : 'user.enable', 'User', id, {});
      });
    },

    async resetPassword(id: string, password: string) {
      const session = getSession();
      const user = await db.user.findUnique({ where: { id } });
      if (!user) throw new AppError('NOT_FOUND', 'Employé introuvable.');
      if (user.role === 'OWNER' && session?.role !== 'OWNER') throw new AppError('FORBIDDEN', 'Seul un propriétaire peut gérer ce compte.');
      const passwordHash = await hashPassword(password);
      await db.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { passwordHash } });
        await log(tx, 'user.password.reset', 'User', id, {});
      });
    },

    async auditList(limit: number): Promise<AuditEntry[]> {
      const [rows, users] = await Promise.all([
        db.auditLog.findMany({ orderBy: { seq: 'desc' }, take: limit }),
        db.user.findMany({ select: { id: true, name: true } }),
      ]);
      return rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt,
        actorName: users.find((user) => user.id === row.actorId)?.name ?? null,
        action: row.action,
        entityType: row.entityType,
        details: row.details,
      }));
    },
  };
}
