# État du projet

## Vérifié automatiquement

- Tests unitaires et d'intégration, dont l'API sur un vrai PostgreSQL.
- Parcours complets dans Electron et sur la plateforme : vente manuelle, activation en ligne et par fichier, suspension, transfert, deux postes synchronisés, essai, version non couverte, affichage sur téléphone.

## Jamais vérifié

- **Windows réel** : tout le développement et les tests ont lieu sous Linux. La protection DPAPI, l'installateur et les mises à jour n'y ont pas été exercés.
- **Installateur** : il ne peut pas être construit sous Linux, car le module SQLite natif ne se compile pas pour Windows depuis Linux. Il doit l'être sous Windows ou par le workflow `windows.yml`, qui n'a encore jamais abouti.
- **Impression réelle** sur une imprimante.
- **Restauration complète** d'une sauvegarde avec redémarrage de l'application : le déchiffrement et le remplacement du fichier sont testés, pas le parcours entier.

## Limites connues

- Un poste hors ligne n'apprend une suspension, une révocation ou une libération qu'à sa prochaine connexion. C'est le prix de l'autonomie hors ligne.
- Un fichier `licence.json` restauré à la main redonne l'ancien statut jusqu'à la prochaine connexion : le contrôle du jeton plus ancien protège seulement tant que le fichier actuel existe.
- Réinstaller Windows ou remplacer l'ordinateur crée une nouvelle identité de poste : le vendeur doit libérer l'ancienne place si le transfert n'a pas été fait avant.
- Un administrateur de la plateforme qui confirme un paiement engage la délivrance : aucune vérification externe n'existe, par choix du modèle de paiement manuel.
- Le numéro de reçu sert aussi de numéro de vente : ce n'est pas une facture fiscale. Vérifiez vos obligations locales.
- Le journal d'activité chaîné est propre à chaque poste, et n'est pas synchronisé.
