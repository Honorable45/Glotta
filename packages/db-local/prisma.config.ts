import { defineConfig } from 'prisma/config';

// Base de développement uniquement : l'application utilise son propre outil de migration.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: { url: 'file:./.dev/dev.db' },
});
