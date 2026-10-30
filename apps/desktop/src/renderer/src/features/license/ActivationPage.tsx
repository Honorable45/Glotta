import { Alert, Button } from '@gestion/ui';
import { useLicense } from '../../lib/license';
import { useSession } from '../../lib/session';
import { ActivationForms } from './ActivationForms';

export function ActivationPage({ onBrowse }: { onBrowse: () => void }) {
  const { license, setLicense } = useLicense();
  const { can } = useSession();
  let body;
  if (!license?.configured) {
    body = <Alert>La vérification des licences n'est pas configurée dans cette version. Contactez votre vendeur.</Alert>;
  } else if (!can('manage_settings')) {
    body = <p className="text-sm text-muted">Ce poste n'est pas encore activé. Demandez au propriétaire de se connecter pour l'activer.</p>;
  } else {
    body = <ActivationForms online={license.online} onActivated={setLicense} />;
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-lg rounded-lg border border-border bg-surface p-6">
        <h1 className="mb-1 text-lg font-semibold tracking-tight">Activation du logiciel</h1>
        <p className="mb-5 text-sm text-muted">Une fois activé, le logiciel fonctionne sans Internet et sans date d'expiration.</p>
        {body}
        <div className="mt-5 border-t border-border pt-4">
          <Button variant="secondary" onClick={onBrowse}>Consulter mes données sans activer</Button>
        </div>
      </div>
    </div>
  );
}
