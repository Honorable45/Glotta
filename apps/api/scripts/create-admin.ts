import { hashPassword } from '@gestion/license';
import { PrismaPg } from '@prisma/adapter-pg';
import { v7 as newId } from 'uuid';
import { PrismaClient } from '../src/generated/client';
import { newTotpSecret } from '../src/totp';

const [email, password] = process.argv.slice(2);
if (!email || !password || password.length < 12) {
  console.error('Usage : create-admin <email> <mot de passe de 12 caractères ou plus>');
  process.exit(1);
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env['DATABASE_URL']! }) });
const totpSecret = newTotpSecret();
await db.platformAdmin.create({ data: { id: newId(), email: email.toLowerCase(), passwordHash: await hashPassword(password), totpSecret } });
console.log(`Administrateur créé. Clé à ajouter dans votre application d'authentification : ${totpSecret}`);
await db.$disconnect();
