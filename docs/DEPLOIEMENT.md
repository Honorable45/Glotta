# Déploiement

## 1. Générer les clés de licence

```bash
cd apps/api && npx tsx scripts/generate-keys.ts
```

- La clé privée va dans la variable `LICENSE_PRIVATE_KEY` du serveur. Elle permet d'émettre des licences et chiffre les clés de licence au repos : ne la partagez et ne la versionnez jamais.
- Conservez-en une copie hors du serveur. Sans elle, les postes déjà installés n'accepteront plus aucune réponse du serveur, et les clés enregistrées ne seront plus lisibles.
- La clé publique va dans `apps/desktop/resources/license-public.pem` avant le build.

## 2. Déployer l'API et la plateforme

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

Le serveur écoute sur `127.0.0.1:8080` (`HOST` et `PORT` pour changer). Il doit être placé derrière HTTPS : définissez alors `TRUST_PROXY=1`, sinon tous vos clients partagent une seule limite de requêtes. N'activez cette variable que si le port du serveur n'est joignable que par le proxy. `GET /health` vérifie le serveur et sa base.

## 3. Créer le compte propriétaire

```bash
cd apps/api && npx tsx scripts/create-admin.ts admin@exemple.tg "mot de passe de 12 caractères"
```

Ajoutez la clé affichée dans une application d'authentification, puis connectez-vous sur `https://votre-domaine/console/`. Les autres comptes se créent ensuite dans Paramètres.

## 4. Sauvegarder la base du serveur

```bash
BACKUP_DIR=/chemin/sauvegardes apps/api/scripts/backup-db.sh
```

À programmer chaque jour, avec un dossier hors du serveur. Le script garde les 30 derniers fichiers. Pour restaurer : `pg_restore --clean --if-exists -d "$DATABASE_URL" fichier.dump`.

Les données de vos clients ne sont pas dans cette base : les enveloppes de synchronisation sont chiffrées sur les postes, et le serveur ne peut pas les lire.

## 5. Générer l'installateur

Sur Windows, ou via le workflow GitHub `windows.yml` (variables `API_URL` et `LICENSE_PUBLIC_KEY`) :

```bash
MAIN_VITE_API_URL=https://votre-domaine pnpm dist:win
```

Sans certificat de signature de code, Windows SmartScreen avertit à l'installation.

## 6. Vendre une licence

1. **Éditions et tarifs** : créez vos éditions. Aucun prix n'existe dans le code.
2. **Clients** : créez le client.
3. **Ventes** : créez la vente, qui reste en attente, sans clé disponible.
4. Après réception réelle du paiement, **Confirmer le paiement** délivre la licence.
5. Ouvrez la licence, **Afficher la clé**, et transmettez-la au client. Le reçu PDF se télécharge depuis la vente.

Sans Internet chez le client : il crée une demande dans le logiciel et vous la remet. Dans **Licences**, **Activation hors ligne** produit un fichier de licence signé à lui rendre.

## 7. Publier une grande version

1. Publiez la version dans **Versions**.
2. Créez ou modifiez l'édition avec la nouvelle grande version couverte.
3. Pour un client existant, dans **Nouvelle vente**, choisissez ce client, l'édition de la nouvelle version, puis le type de vente « Mise à niveau ». Le droit n'augmente qu'à la confirmation du paiement.

Une licence reste valide pour les versions qu'elle couvre. Une grande version non couverte refuse de démarrer sans modifier les données, et le client peut réinstaller sa version.
