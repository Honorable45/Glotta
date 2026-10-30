# Gestion Commerciale

Logiciel desktop de gestion commerciale pour Windows, utilisable hors ligne, vendu en licence à vie, avec une plateforme web privée de gestion des clients, ventes et licences.

## Commandes

| Commande | Rôle |
|---|---|
| `pnpm install` | Installe les dépendances et génère le client Prisma local |
| `pnpm --filter @gestion/api generate` | Génère le client Prisma du serveur |
| `pnpm test:db` | Démarre le PostgreSQL de test avec podman et applique les migrations |
| `pnpm dev` | Lance l'application en développement |
| `pnpm verify` | Compilation, tests unitaires, puis parcours complets dans Electron |
| `pnpm dist:win` | Génère l'installateur Windows dans `apps/desktop/dist` |

Le déploiement du serveur et de l'installateur est décrit dans [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md), et les limites connues dans [docs/ETAT-DU-PROJET.md](docs/ETAT-DU-PROJET.md).

## Structure

- `apps/desktop` : application Electron (`main`, `preload`, `renderer`).
- `apps/api` : API centrale : activation, statut et transfert des licences, ventes, reçus PDF, relais de synchronisation.
- `apps/admin` : plateforme web privée, responsive, servie par l'API sur `/console/`.
- `packages/contracts` : canaux IPC, schémas de validation, niveau d'accès et droits d'édition de chaque canal.
- `packages/domain` : règles pures : montants, ventes, retours, permissions, WhatsApp.
- `packages/license` : signature et vérification des licences, mots de passe.
- `packages/db-local` : schéma Prisma local, migrations, journal d'activité.
- `packages/sqlite-driver` : remplace `better-sqlite3` pour l'adaptateur Prisma et impose le chiffrement.
- `packages/ui` : design system.

## Règles du socle

- Toute requête du renderer passe par `apps/desktop/src/main/ipc/dispatcher.ts` : origine, session, permission, licence, validation, traitement.
- Un nouveau canal doit déclarer son niveau d'accès dans `channelAccess`, sinon la compilation échoue. S'il modifie l'activité, l'ajouter à `writeChannels`.
- Un changement métier appelle `logger()` dans sa transaction.
- Les historiques financiers et de stock sont en ajout seul, protégés par des déclencheurs SQL.
- Les montants et quantités sont des entiers : jamais de flottants.
- Une entrée de navigation n'est ajoutée que si son module fonctionne réellement.

## Règles de la licence

- La clé privée de signature reste sur le serveur. Le logiciel ne contient que la clé publique.
- Un statut ne change sur le poste que par un jeton signé, destiné à ce poste, et pas plus ancien que l'actuel.
- Ni la date ni le réseau n'interviennent pour une licence à vie. Seul un essai a une date de fin.
- Une licence bloquée laisse la consultation et l'export ouverts : la base locale n'est jamais touchée.
- Le droit aux versions est contrôlé au démarrage, avant toute migration.
- Une licence n'est délivrée que par la confirmation du paiement sur la plateforme.

## Ajouter une migration locale

1. Copier `packages/db-local/prisma/schema.prisma`, puis le modifier.
2. Depuis `packages/db-local`, générer le SQL : `prisma migrate diff --from-schema <copie> --to-schema prisma/schema.prisma --script`.
3. L'enregistrer dans `prisma/migrations/<horodatage>_<nom>/migration.sql`.

Une migration livrée n'est jamais modifiée : l'application refuse alors de démarrer. Une migration qui reconstruit une table doit recréer ses déclencheurs d'ajout seul et de synchronisation. Une nouvelle table à synchroniser doit être ajoutée à `TABLES` dans `sync.service.ts`, avec ses déclencheurs.
# Glotta
