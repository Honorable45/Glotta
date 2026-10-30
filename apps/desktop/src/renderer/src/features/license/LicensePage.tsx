import { Alert, Button, Card, DetailList } from '@gestion/ui';
import { useState } from 'react';
import { call } from '../../lib/api';
import { useLicense } from '../../lib/license';
import { ActivationForms } from './ActivationForms';

const statusLabels: Record<string, string> = {
  NONE: 'Non activée', ACTIVE: 'Active', TRIAL: 'Essai en cours', TRIAL_ENDED: 'Essai terminé', SUSPENDED: 'Suspendue', REVOKED: 'Révoquée',
};

export function LicensePage() {
  const { license, setLicense } = useLicense();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [transferring, setTransferring] = useState(false);
  if (!license) return null;
  const activated = license.status !== 'NONE';
  const run = (action: Promise<typeof license>, done: string) => {
    setError(null);
    setMessage(null);
    action.then((next) => { setLicense(next); setMessage(done); setTransferring(false); }).catch((cause: Error) => setError(cause.message));
  };
  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {message && <p role="status" className="rounded-md bg-selected px-3.5 py-2.5 text-sm text-selected-text">{message}</p>}
      <Card title="Ma licence">
        <DetailList
          items={[
            { label: 'État', value: statusLabels[license.status] },
            ...(license.editionName ? [{ label: 'Édition', value: `${license.editionName}${license.isTrial ? ' (essai)' : ''}` }] : []),
            ...(license.trialEndsAt ? [{ label: "Fin de l'essai", value: new Date(license.trialEndsAt).toLocaleDateString('fr-FR') }] : []),
            ...(activated && !license.isTrial ? [{ label: 'Durée', value: 'À vie, sans expiration' }] : []),
            ...(license.maxMajorVersion !== null ? [{ label: 'Versions couvertes', value: `Jusqu'à ${license.maxMajorVersion}.x` }] : []),
          ]}
        />
        {activated && (
          <div className="mt-4 flex flex-wrap gap-2">
            {license.online && <Button variant="secondary" onClick={() => run(call('license.refresh', undefined), 'Licence vérifiée.')}>Vérifier maintenant</Button>}
            {license.online && <Button variant="secondary" onClick={() => setTransferring(true)}>Transférer vers un autre ordinateur</Button>}
          </div>
        )}
        {transferring && (
          <div className="mt-4 flex flex-col gap-3 rounded-md border border-border p-3">
            <p className="text-sm">Ce poste ne pourra plus créer de nouvelles opérations, mais ses données resteront ici, consultables et exportables. Faites une sauvegarde avant de continuer pour les retrouver sur le nouvel ordinateur.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => run(call('license.transfer', undefined), 'Licence libérée. Activez-la sur le nouvel ordinateur avec la même clé.')}>Libérer ce poste</Button>
              <Button variant="secondary" onClick={() => setTransferring(false)}>Annuler</Button>
            </div>
          </div>
        )}
        {activated && !license.online && <p className="mt-3 text-sm text-muted">Pour un transfert, contactez votre vendeur : il libérera ce poste depuis sa plateforme.</p>}
      </Card>
      {(!activated || license.status === 'TRIAL_ENDED') && license.configured && (
        <Card title="Activer une licence">
          <ActivationForms online={license.online} onActivated={(next) => { setLicense(next); setMessage('Licence activée.'); }} />
        </Card>
      )}
    </div>
  );
}
