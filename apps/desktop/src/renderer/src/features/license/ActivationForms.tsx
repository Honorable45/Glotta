import type { LicenseState } from '@gestion/contracts';
import { Alert, Button, Field, Input, SegmentedControl, Textarea } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';

/** Activation en ligne, ou hors ligne par échange de fichiers ou de codes signés. */
export function ActivationForms({ online, onActivated }: { online: boolean; onActivated: (license: LicenseState) => void }) {
  const [mode, setMode] = useState<'online' | 'offline'>(online ? 'online' : 'offline');
  const [licenseKey, setLicenseKey] = useState('');
  const [request, setRequest] = useState<string | null>(null);
  const [token, setToken] = useState('');
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = <T,>(action: Promise<T>, done: (value: T) => void) => {
    setBusy(true);
    setError(null);
    action.then(done).catch((cause: Error) => setError(cause.message)).finally(() => setBusy(false));
  };
  const accepted = (license: LicenseState) => { if (license.status !== 'NONE') onActivated(license); };
  const keyField = <Field label="Clé de licence" hint="Elle vous a été remise après la confirmation de votre paiement."><Input autoComplete="off" placeholder="GC-XXXXX-XXXXX-XXXXX-XXXXX" value={licenseKey} onChange={(event) => setLicenseKey(event.target.value)} /></Field>;

  return (
    <div className="flex flex-col gap-4">
      {online && (
        <SegmentedControl
          label="Mode d'activation"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'online', label: 'En ligne' },
            { value: 'offline', label: 'Sans Internet' },
          ]}
        />
      )}
      {mode === 'online' ? (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(call('license.activate', { licenseKey }), onActivated);
          }}
        >
          {keyField}
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={busy || !licenseKey.trim()}>Activer ce poste</Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">1. Créez une demande et remettez-la à votre vendeur. 2. Il vous rend un fichier de licence signé, à importer ici.</p>
          {keyField}
          <div><Button variant="secondary" disabled={busy || !licenseKey.trim()} onClick={() => run(call('license.offlineRequest', { licenseKey }), (result) => setRequest(result.request))}>Créer la demande</Button></div>
          {request && (
            <div className="flex flex-col gap-2">
              <p data-testid="offline-request" className="max-h-24 overflow-auto break-all rounded-md bg-canvas p-3 font-mono text-xs">{request}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => run(call('license.saveRequest', { request }), (result) => setSavedPath(result.path))}>Enregistrer dans un fichier</Button>
                {savedPath && <span role="status" className="break-all text-xs text-muted">{savedPath}</span>}
              </div>
            </div>
          )}
          <Field label="Code de licence reçu"><Textarea aria-label="Code de licence reçu" value={token} onChange={(event) => setToken(event.target.value)} /></Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !token.trim()} onClick={() => run(call('license.importToken', { token }), accepted)}>Valider le code</Button>
            <Button variant="secondary" disabled={busy} onClick={() => run(call('license.importFile', undefined), accepted)}>Importer un fichier de licence</Button>
          </div>
        </div>
      )}
    </div>
  );
}
