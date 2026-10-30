import { Link } from 'react-router-dom';
import { useLicense } from '../../lib/license';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');

export function LicenseBanner() {
  const { license } = useLicense();
  if (!license) return null;
  const messages: Partial<Record<typeof license.status, string>> = {
    EXPIRING: `Votre ${license.isTrial ? 'essai' : 'abonnement'} expire le ${date(license.expiresAt)}.`,
    GRACE: `Votre abonnement a expiré. Renouvelez-le avant le ${date(license.graceUntil)} pour continuer à vendre.`,
    EXPIRED: 'Votre abonnement a expiré. Les nouvelles opérations sont bloquées. Vos données restent consultables et exportables.',
    SUSPENDED: 'Votre abonnement est suspendu. Contactez l’assistance. Vos données restent consultables et exportables.',
    OFFLINE_EXPIRED: 'Connectez ce poste à Internet pour vérifier votre abonnement. Les nouvelles opérations sont bloquées en attendant.',
    CLOCK_TAMPERED: "L'heure de cet ordinateur semble incorrecte. Corrigez-la, puis connectez-vous à Internet.",
  };
  const message = messages[license.status];
  if (!message) return null;
  return (
    <div role="alert" className={`flex items-center justify-between gap-4 border-b border-border px-8 py-2.5 text-sm ${license.canOperate ? 'bg-selected text-selected-text' : 'bg-danger-bg text-danger'}`}>
      {message}
      <Link to="/abonnement" className="shrink-0 font-medium underline">Renouveler</Link>
    </div>
  );
}
