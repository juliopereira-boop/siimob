// @ts-check
// ─── As páginas saem nos mesmos endereços de antes ───────────────────────────
//
// O código mora em src/pages/<tela>/index.html, mas o que está publicado hoje é
// /<tela>.html — e é para lá que apontam vercel.json, os links salvos pelos
// clientes, o servidor de testes e alguns redirecionamentos no próprio código.
// Mudar o endereço publicado junto com a organização do código seria trocar
// duas coisas de uma vez; este plugin mantém a primeira sem tocar na segunda.
/** @returns {import('vite').Plugin} */
export default function paginasNaRaiz() {
  return {
    name: 'siimob:paginas-na-raiz',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) {
        const m = item.type === 'asset' && item.fileName.match(/^src\/pages\/([^/]+)\/index\.html$/);
        if (m) item.fileName = `${m[1]}.html`;
      }
    }
  };
}
