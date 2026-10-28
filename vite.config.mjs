// ─── Build do SIIMOB ────────────────────────────────────────────────────────
//
// Uma entrada por tela (src/pages/<tela>/index.html). O resultado em dist/ é o
// que a Vercel publica: as páginas na raiz com os nomes de sempre, e JS/CSS em
// /static com hash no nome (cache longo sem risco de versão velha).
//
//   npm run dev       servidor de desenvolvimento, com as rotas de vercel.json
//   npm run build     gera dist/
//   npm run preview   serve dist/ como a produção serviria
import { defineConfig } from 'vite';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import scriptsClassicos from './tools/vite/scripts-classicos.mjs';
import paginasNaRaiz from './tools/vite/paginas-na-raiz.mjs';
import rotasVercel from './tools/vite/rotas-vercel.mjs';

const telas = Object.fromEntries(
  readdirSync('src/pages', { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => [d.name, resolve('src/pages', d.name, 'index.html')])
);

export default defineConfig({
  appType: 'mpa',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'static',
    rollupOptions: { input: telas }
  },
  plugins: [scriptsClassicos(), paginasNaRaiz(), rotasVercel()],
  server: { port: 3000, strictPort: true },
  preview: { port: 4173 }
});
