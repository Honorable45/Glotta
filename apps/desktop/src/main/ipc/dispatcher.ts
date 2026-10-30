import { channelAccess, contract, type Channel, type Input, type IpcResult, type Output } from '@gestion/contracts';
import { AppError } from '../core/errors';

export type Handlers = { [C in Channel]: (input: Input<C>) => Promise<Output<C>> | Output<C> };

/**
 * Point de passage unique de toutes les requêtes du renderer, qui n'est jamais considéré comme
 * fiable : origine, puis validation de l'entrée, puis traitement, puis contrôle de la sortie.
 */
export function createDispatcher(
  handlers: Handlers,
  isTrustedSender: (url: string | undefined) => boolean,
  authorize: (access: (typeof channelAccess)[Channel], channel: Channel) => void = () => undefined,
) {
  return async function dispatch(channel: string, senderUrl: string | undefined, rawInput: unknown): Promise<IpcResult<unknown>> {
    const fail = (code: AppError['code'], message: string) => ({ ok: false as const, error: { code, message } });
    if (!isTrustedSender(senderUrl)) return fail('FORBIDDEN', 'Origine non autorisée.');
    if (!Object.hasOwn(contract, channel)) return fail('UNKNOWN_CHANNEL', 'Opération inconnue.');

    const name = channel as Channel;
    try {
      authorize(channelAccess[name], name);
    } catch (error) {
      if (error instanceof AppError) return fail(error.code, error.message);
      throw error;
    }

    const input = contract[name].input.safeParse(rawInput);
    if (!input.success) {
      // Le schéma ne décrit que le contrat : son message ne révèle rien d'interne.
      const issue = input.error.issues[0];
      const friendly = issue?.code === 'custom' || issue?.code === 'too_small' || issue?.code === 'invalid_format';
      return fail('INVALID_INPUT', friendly && issue ? issue.message : 'Données invalides.');
    }

    try {
      const handler = handlers[name] as (input: unknown) => unknown;
      const data = contract[name].output.parse(await handler(input.data));
      return { ok: true, data };
    } catch (error) {
      if (error instanceof AppError) return fail(error.code, error.message);
      console.error(`[ipc] ${channel}`, error);
      return fail('INTERNAL', 'Une erreur interne est survenue.');
    }
  };
}
