// ─── As rotas do SIIMOB, lidas de vercel.json ────────────────────────────────
//
// POR QUE ESTE ARQUIVO EXISTE
// As rotas bonitas (/cliente/repasse) são reescritas, e o apelido do cliente é
// lido do próprio caminho (A1.slug). Quem serve o sistema fora da Vercel (o
// servidor de desenvolvimento, o da suíte de testes, o servidor local) precisa
// aplicar AS MESMAS regras. Antes, cada um tinha a sua cópia deste parser; agora
// todos leem vercel.json por aqui, e uma rota nova vale em todo lugar ao mesmo
// tempo.
const fs = require('fs');
const path = require('path');

const RAIZ = path.join(__dirname, '..');

function carregarRotas(raiz = RAIZ) {
  const conf = JSON.parse(fs.readFileSync(path.join(raiz, 'vercel.json'), 'utf8'));
  return (conf.rewrites || []).map(r => ({
    re: new RegExp('^' + r.source
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
      .replace(/:\w+/g, '[^/]+')
      .replace(/\*/g, '.*') + '/?$'),
    fonte: r.source,
    destino: r.destination
  }));
}

// Caminho pedido → arquivo publicado (o mesmo que a Vercel entregaria).
function reescrever(caminho, rotas) {
  const regra = rotas.find(r => r.re.test(caminho));
  return regra ? regra.destino : caminho;
}

module.exports = { carregarRotas, reescrever, RAIZ };
