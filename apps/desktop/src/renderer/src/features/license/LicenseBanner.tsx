import { Link } from 'react-router-dom';
import { useLicense } from '../../lib/license';

export function LicenseBanner() {
  const { license } = useLicense();
  if (!license) return null;
  const blocked = 'Les nouvelles opérations sont bloquées. Vos données restent consultables et exportables.';
  const trialEnd = license.trialEndsAt ? new Date(license.trialEndsAt).toLocaleDateString('fr-FR') : '';
  const messages: Partial<Record<typeof license.status, string>> = {
    NONE: `Ce poste n'est pas activé. ${blocked}`,
    TRIAL: `Version d'essai, jusqu'au ${trialEnd}.`,
    TRIAL_ENDED: `Votre essai est terminé. ${blocked}`,
    SUSPENDED: `Votre licence est suspendue. Contactez votre vendeur. ${blocked}`,
    REVOKED: `Votre licence a été révoquée. Contactez votre vendeur. ${blocked}`,
  };
  const message = messages[license.status];
  if (!message) return null;
  return (
    <div role="alert" className={`flex items-center justify-between gap-4 border-b border-border px-8 py-2.5 text-sm ${license.canOperate ? 'bg-selected text-selected-text' : 'bg-danger-bg text-danger'}`}>
      {message}
      <Link to="/licence" className="shrink-0 font-medium underline">Voir ma licence</Link>
    </div>
  );
}
