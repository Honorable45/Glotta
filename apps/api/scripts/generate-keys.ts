import { generateLicenseKeys } from '@gestion/license';

const { publicKeyPem, privateKeyPem } = generateLicenseKeys();
console.log('Clé privée (LICENSE_PRIVATE_KEY du serveur, à ne jamais partager) :\n');
console.log(privateKeyPem);
console.log('Clé publique (apps/desktop/resources/license-public.pem) :\n');
console.log(publicKeyPem);
