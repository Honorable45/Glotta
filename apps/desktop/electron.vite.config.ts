import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const PROD_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'";
// Le rechargement à chaud de Vite a besoin de scripts en ligne et d'un WebSocket.
const DEV_CSP =
  "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws:";

function contentSecurityPolicy(): Plugin {
  return {
    name: 'content-security-policy',
    transformIndexHtml(html, context) {
      return html.replace('__CSP__', context.server ? DEV_CSP : PROD_CSP);
    },
  };
}

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  },
});
