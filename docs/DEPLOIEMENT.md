# Déploiement

## 1. Générer les clés de licence

```bash
cd apps/api && npx tsx scripts/generate-keys.ts
```

- La clé privée va dans la variable `LICENSE_PRIVATE_KEY` du serveur. Elle ne doit jamais être partagée ni versionnée : elle permet d'émettre des licences.
- La clé publique va dans `apps/desktop/resources/license-public.pem` avant le build.

## 2. Déployer l'API

Prérequis : Node 22 ou plus, PostgreSQL 16 et un reverse proxy HTTPS.

```bash
pnpm install
pnpm --filter @gestion/api generate
pnpm --filter @gestion/admin build
export DATABASE_URL=postgresql://...
export LICENSE_PRIVATE_KEY="$(cat cle-privee.pem)"
export ADMIN_DIST="$PWD/apps/admin/dist"
pnpm --filter @gestion/api migrate
pnpm --filter @gestion/api start
```

Le serveur écoute sur `127.0.0.1:8080` (`HOST` et `PORT` pour changer). Il doit être placé derrière HTTPS.

## 3. Créer l'administrateur

```bash
cd apps/api && npx tsx scripts/create-admin.ts admin@exemple.tg "mot de passe de 12 caractères"
```

Ajoutez la clé affichée dans une application d'authentification, puis connectez-vous sur `https://votre-domaine/console/`.

## 4. Générer l'installateur

Sur Windows, ou via le workflow GitHub `windows.yml` (variables `API_URL` et `LICENSE_PUBLIC_KEY`) :

```bash
MAIN_VITE_API_URL=https://votre-domaine pnpm dist:win
```

Sans certificat de signature de code, Windows SmartScreen avertit à l'installation.

## 5. Brancher un prestataire de paiement

Tant que `providers` est vide dans `apps/api/src/server.ts`, le paiement en ligne est refusé avec un message clair. Pour en brancher un, implémentez `PaymentProvider` (`apps/api/src/providers.ts`) d'après sa documentation officielle, et testez-le avec votre compte marchand. La notification ne valide jamais seule un paiement : `fetchStatus` doit interroger le prestataire.

Déclarez ensuite l'adresse `https://votre-domaine/v1/payments/webhook/<nom>` chez le prestataire. En attendant, l'activation manuelle se fait dans la console (« Prolonger », avec motif journalisé).
