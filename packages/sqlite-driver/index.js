const Cipher = require('better-sqlite3-multiple-ciphers');

const HEX_KEY = /^[0-9a-f]{64}$/;

/**
 * Ouvre une base SQLite chiffrée. Sans clé valide, l'ouverture échoue : l'application
 * ne doit jamais pouvoir créer ou lire une base en clair par erreur.
 */
module.exports = function Database(path, { encryptionKey, ...options } = {}) {
  if (typeof encryptionKey !== 'string' || !HEX_KEY.test(encryptionKey)) {
    throw new Error('Clé de chiffrement absente ou invalide.');
  }
  const db = new Cipher(path, options);
  try {
    db.pragma(`key = "x'${encryptionKey}'"`);
    // Une mauvaise clé n'est détectée qu'à la première lecture.
    db.prepare('SELECT count(*) FROM sqlite_master').get();
    db.pragma('journal_mode = WAL');
    // FULL : une vente validée survit à une coupure de courant.
    db.pragma('synchronous = FULL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
};
