import { userInputSchema, type UserItem } from '@gestion/contracts';
import { allPermissions, effectivePermissions, permissionLabels, roleLabels, type Permission, type Role } from '@gestion/domain';
import { Alert, Badge, Button, Card, Checkbox, DataTable, Field, Input, Select } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useLoad } from '../../lib/useLoad';

interface Form {
  id: string | null;
  name: string;
  login: string;
  role: Role;
  overrides: Partial<Record<Permission, boolean>>;
  password: string;
}
const empty: Form = { id: null, name: '', login: '', role: 'SELLER', overrides: {}, password: '' };

export function UsersPage() {
  const { session, refresh } = useSession();
  const { data, error, reload, setError } = useLoad(() => call('users.list', undefined));
  const [form, setForm] = useState<Form>(empty);
  const [resetFor, setResetFor] = useState<UserItem | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const roles = (Object.keys(roleLabels) as Role[]).filter((role) => role !== 'OWNER' || session?.role === 'OWNER');
  const granted = effectivePermissions(form.role, form.overrides);

  const save = () => {
    setError(null);
    const parsed = userInputSchema.safeParse({ ...form, name: form.name.trim(), password: form.password || null });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Vérifiez les informations saisies.');
      return;
    }
    call('users.save', parsed.data)
      .then(async () => {
        setForm(empty);
        await refresh();
        return reload();
      })
      .catch((cause: Error) => setError(cause.message));
  };

  const toggle = (permission: Permission, on: boolean) => {
    const base = effectivePermissions(form.role, {}).includes(permission);
    const overrides = { ...form.overrides };
    // Seul un écart au rôle est conservé : changer de rôle reste prévisible.
    if (on === base) delete overrides[permission];
    else overrides[permission] = on;
    setForm({ ...form, overrides });
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <Card title={form.id ? "Modifier l'employé" : 'Nouvel employé'}>
        <div className="grid grid-cols-4 gap-3">
          <Field label="Nom"><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></Field>
          <Field label="Identifiant"><Input value={form.login} onChange={(event) => setForm({ ...form, login: event.target.value })} /></Field>
          <Field label="Rôle">
            <Select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role, overrides: {} })}>
              {roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}
            </Select>
          </Field>
          {!form.id && <Field label="Mot de passe"><Input type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} /></Field>}
        </div>
        {form.role !== 'OWNER' && (
          <fieldset className="mt-4">
            <legend className="mb-2 text-sm font-medium">Permissions</legend>
            <div className="grid grid-cols-3 gap-x-4 gap-y-2">
              {allPermissions.map((permission) => (
                <Checkbox key={permission} label={permissionLabels[permission]} checked={granted.includes(permission)} onChange={(event) => toggle(permission, event.target.checked)} />
              ))}
            </div>
          </fieldset>
        )}
        <div className="mt-5 flex gap-2">
          <Button disabled={!form.name.trim() || !form.login.trim()} onClick={save}>Enregistrer</Button>
          {form.id && <Button variant="secondary" onClick={() => setForm(empty)}>Annuler</Button>}
        </div>
      </Card>
      {resetFor && (
        <Card title={`Nouveau mot de passe pour ${resetFor.name}`}>
          <div className="flex items-end gap-3">
            <Field label="Mot de passe"><Input type="password" autoComplete="new-password" value={resetPassword} onChange={(event) => setResetPassword(event.target.value)} /></Field>
            <Button onClick={() => call('users.resetPassword', { id: resetFor.id, password: resetPassword }).then(() => { setResetFor(null); setResetPassword(''); }).catch((cause: Error) => setError(cause.message))}>Enregistrer</Button>
            <Button variant="secondary" onClick={() => setResetFor(null)}>Fermer</Button>
          </div>
        </Card>
      )}
      <Card title="Employés">
        <DataTable<UserItem>
          rows={data ?? []}
          rowKey={(row) => row.id}
          empty="Aucun employé."
          columns={[
            { header: 'Nom', render: (row) => row.name },
            { header: 'Identifiant', render: (row) => row.login },
            { header: 'Rôle', render: (row) => roleLabels[row.role] },
            { header: 'État', render: (row) => <Badge tone={row.disabled ? 'danger' : 'success'}>{row.disabled ? 'Désactivé' : 'Actif'}</Badge> },
            {
              header: 'Actions',
              align: 'right',
              render: (row) => (
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setForm({ id: row.id, name: row.name, login: row.login, role: row.role, overrides: row.overrides, password: '' })}>Modifier</Button>
                  <Button variant="secondary" onClick={() => setResetFor(row)}>Mot de passe</Button>
                  {row.id !== session?.id && (
                    <Button variant="secondary" onClick={() => call('users.setDisabled', { id: row.id, disabled: !row.disabled }).then(reload).catch((cause: Error) => setError(cause.message))}>
                      {row.disabled ? 'Activer' : 'Désactiver'}
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
}
