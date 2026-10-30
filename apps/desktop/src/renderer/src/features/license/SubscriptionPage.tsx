import type { PlanItem } from '@gestion/contracts';
import { formatAmount } from '@gestion/domain';
import { Alert, Button, Card, DataTable, DetailList, Field, Select } from '@gestion/ui';
import { useEffect, useState } from 'react';
import { call } from '../../lib/api';
import { useLicense } from '../../lib/license';

const statusLabels: Record<string, string> = {
  NONE: 'Non activé', ACTIVE: 'Actif', EXPIRING: 'Expire bientôt', GRACE: 'Période de grâce', EXPIRED: 'Expiré',
  SUSPENDED: 'Suspendu', OFFLINE_EXPIRED: 'Vérification nécessaire', CLOCK_TAMPERED: 'Heure incorrecte',
};

export function SubscriptionPage() {
  const { license, setLicense, reload } = useLicense();
  const [plans, setPlans] = useState<PlanItem[]>([]);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState(1);
  const [intent, setIntent] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    call('license.plans', undefined).then(setPlans).catch((cause: Error) => setPlansError(cause.message));
  }, []);

  const pay = (planCode: string) => {
    setError(null);
    setMessage(null);
    call('license.pay', { planCode, months })
      .then(({ intentId }) => {
        setIntent(intentId);
        setMessage('La page de paiement est ouverte dans votre navigateur. Revenez ici une fois le paiement terminé.');
      })
      .catch((cause: Error) => setError(cause.message));
  };

  const check = () => {
    if (!intent) return;
    setError(null);
    call('license.paymentStatus', { intentId: intent })
      .then(async ({ status }) => {
        await reload();
        if (status === 'CONFIRMED') {
          setIntent(null);
          setMessage('Paiement confirmé par le prestataire. Votre abonnement est à jour.');
        } else {
          setMessage(status === 'FAILED' ? 'Le paiement a échoué.' : 'Le prestataire n’a pas encore confirmé le paiement.');
        }
      })
      .catch((cause: Error) => setError(cause.message));
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      {message && <p role="status" className="rounded-md bg-selected px-3.5 py-2.5 text-sm text-selected-text">{message}</p>}
      <Card title="Mon abonnement">
        <DetailList
          items={[
            { label: 'Formule', value: license?.planCode ? `${license.planCode}${license.isTrial ? ' (essai)' : ''}` : 'Aucune' },
            { label: 'État', value: statusLabels[license?.status ?? 'NONE'] },
            { label: "Date d'expiration", value: license?.expiresAt ? new Date(license.expiresAt).toLocaleDateString('fr-FR') : 'Non définie' },
          ]}
        />
        <div className="mt-4 flex gap-2">
          <Button variant="secondary" onClick={() => call('license.refresh', undefined).then(setLicense).catch((cause: Error) => setError(cause.message))}>Vérifier maintenant</Button>
          {intent && <Button onClick={check}>J'ai payé, vérifier</Button>}
        </div>
      </Card>
      <Card title="Formules">
        {plansError ? <p className="text-sm text-muted">{plansError}</p> : (
          <>
            <div className="mb-3 w-40">
              <Field label="Durée">
                <Select value={months} onChange={(event) => setMonths(Number(event.target.value))}>
                  {[1, 3, 6, 12].map((value) => <option key={value} value={value}>{value} mois</option>)}
                </Select>
              </Field>
            </div>
            <DataTable<PlanItem>
              rows={plans}
              rowKey={(plan) => plan.code}
              empty="Aucune formule disponible."
              columns={[
                { header: 'Formule', render: (plan) => plan.name },
                { header: 'Utilisateurs', align: 'right', render: (plan) => plan.maxUsers },
                { header: 'Prix par mois', align: 'right', render: (plan) => formatAmount(BigInt(plan.price), 'XOF') },
                { header: 'Action', align: 'right', render: (plan) => <Button variant="secondary" onClick={() => pay(plan.code)}>Payer {formatAmount(BigInt(plan.price * months), 'XOF')}</Button> },
              ]}
            />
          </>
        )}
      </Card>
    </div>
  );
}
