import type { ErrorCode } from '@gestion/contracts';

/** Erreur dont le message peut être montré à l'utilisateur. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}
