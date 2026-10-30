import { PrismaPg } from '@prisma/adapter-pg';
import { buildApp } from './app';
import { PrismaClient } from './generated/client';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name}`);
  return value;
}

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: required('DATABASE_URL') }) });
// Aucun prestataire tant qu'un adaptateur réel n'a pas été validé avec un compte marchand.
const app = await buildApp({ db, licensePrivateKey: required('LICENSE_PRIVATE_KEY').replaceAll('\\n', '\n'), providers: {}, defaultProvider: null, ...(process.env['ADMIN_DIST'] ? { adminDist: process.env['ADMIN_DIST'] } : {}) });
await app.listen({ port: Number(process.env['PORT'] ?? 8080), host: process.env['HOST'] ?? '127.0.0.1' });
