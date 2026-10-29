// Ações do HTML: data-acao + delegação (src/shared/ui/acoes.js).
//
// POR QUE ESTE ARQUIVO EXISTE
// Até a fase 3b o HTML chamava funções pelo nome (onclick="abrirCaso(...)"), e
// cada uma precisava estar no window. Agora o elemento declara a ação e o
// módulo dono registra o que ela faz. Duas coisas podem quebrar sem que nenhuma
// outra suíte perceba:
//
// 1. Um botão declara uma ação que a página não registra: o clique não faz
//    nada (é o mesmo que um onclick com nome errado, que também não fazia
//    nada). Aqui isso é conferido no código, página por página, seguindo os
//    import de cada tela.
// 2. A delegação deixar de se comportar como o onclick: ordem das ações
//    aninhadas, stopPropagation, eventos que não sobem, a tela redesenhada no
//    meio do clique. Isso é conferido no navegador, com o arquivo de verdade.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { checa, resumo } = require('./comum');
const { lerFonte } = require('./fonte');

const RAIZ = path.join(__dirname, '..');

// ── o grafo de import de cada tela ───────────────────────────────────────────
function modulosDe(arquivo, vistos = new Set()) {
  if (vistos.has(arquivo) || !fs.existsSync(path.join(RAIZ, arquivo))) return vistos;
  vistos.add(arquivo);
  const s = lerFonte(arquivo);
  for (const m of s.matchAll(/^import\s(?:[\s\S]*?\sfrom\s)?'([^']+)';/gm)) {
    modulosDe(path.posix.normalize(path.posix.join(path.posix.dirname(arquivo), m[1])), vistos);
  }
  return vistos;
}

// Nomes registrados: chaves de acoes({...}) e as ações de DOM do próprio acoes.js.
function registrados(s) {
  const out = [];
  for (const m of s.matchAll(/^acoes\(\{\n([\s\S]*?)\n\}\);$/gm)) {
    for (const k of m[1].matchAll(/^ {2}([\w$]+): /gm)) out.push(k[1]);
  }
  for (const k of s.matchAll(/registro\.set\('([\w$]+)'/g)) out.push(k[1]);
  return out;
}

// Nomes declarados no HTML: data-acao="x" e data-acao-<evento>="x" com nome fixo,
// e os itens da sub-barra do casco ({ acao: 'x' }), que viram data-acao lá.
function declarados(texto) {
  // linhas de comentário trazem exemplos (o próprio acoes.js), não ações
  const s = texto.replace(/^\s*(\/\/|\*).*$/gm, '');
  const out = new Set();
  for (const m of s.matchAll(/data-acao(?:-[a-z]+)?="([\w$]+)"/g)) out.add(m[1]);
  for (const m of s.matchAll(/data-acao(?:-[a-z]+)?="\$\{[^}]*?'([\w$]+)'\s*:\s*'([\w$]+)'\s*\}"/g)) {
    out.add(m[1]);
    out.add(m[2]);
  }
  for (const m of s.matchAll(/\bacao: '([\w$]+)'/g)) out.add(m[1]);
  return out;
}

// Botões que já não faziam nada ANTES da troca: chamavam funções que nunca
// existiram no código (ReferenceError no clique). Ficam declarados como estavam,
// à espera de decisão do dono, e listados aqui para não sumirem de vista.
const SEM_FUNCAO_DESDE_ANTES = {
  comercial: ['abrirVendaAvulsa', 'criarVendaAvulsa'],
  superadmin: ['apagarTransicao']
};

// O único handler inline aceito: o que roda antes de qualquer módulo existir
// (a folha de fontes carregada sem bloquear) e o botão de imprimir de um
// documento aberto noutra janela, onde não há delegação.
const INLINE_ACEITO = [/^this\.media='all'$/, /^window\.print\(\)$/];

const TELAS = fs
  .readdirSync(path.join(RAIZ, 'src/pages'))
  .filter(d => fs.existsSync(path.join(RAIZ, 'src/pages', d, 'index.html')))
  .sort();

(async () => {
  console.log('== NENHUM HANDLER INLINE ==');
  const arquivos = [];
  (function varre(dir) {
    for (const e of fs.readdirSync(path.join(RAIZ, dir), { withFileTypes: true })) {
      const rel = path.posix.join(dir, e.name);
      if (e.isDirectory()) varre(rel);
      else if (/\.(js|html)$/.test(e.name)) arquivos.push(rel);
    }
  })('src');
  const inline = [];
  for (const f of arquivos) {
    const s = lerFonte(f);
    for (const m of s.matchAll(/\son([a-z]+)\s*=\s*"([^"]*)"/g)) {
      const linha = s.slice(s.lastIndexOf('\n', m.index) + 1, m.index).trim();
      if (linha.startsWith('//') || linha.startsWith('*')) continue;
      if (INLINE_ACEITO.some(r => r.test(m[2]))) continue;
      inline.push(`${f}:${s.slice(0, m.index).split('\n').length} on${m[1]}="${m[2].slice(0, 50)}"`);
    }
  }
  checa(
    'src/ não tem onclick, onchange... (fora as exceções documentadas)',
    inline.length === 0,
    inline[0] || ''
  );

  console.log('\n== TODA AÇÃO DECLARADA ESTÁ REGISTRADA NA PRÓPRIA PÁGINA ==');
  for (const tela of TELAS) {
    const mods = [...modulosDe(`src/pages/${tela}/main.js`)];
    const codigo = mods.map(lerFonte);
    const regs = codigo.flatMap(registrados);
    const usados = new Set([...declarados(lerFonte(`src/pages/${tela}/index.html`))]);
    codigo.forEach(s => declarados(s).forEach(n => usados.add(n)));
    const conhecidos = SEM_FUNCAO_DESDE_ANTES[tela] || [];
    const faltam = [...usados].filter(n => !regs.includes(n) && !conhecidos.includes(n));
    checa(`${tela}: ${usados.size} ações, todas registradas`, faltam.length === 0, faltam.join(', '));
    const dup = regs.filter((n, i) => regs.indexOf(n) !== i);
    checa(`${tela}: nenhum nome registrado duas vezes`, dup.length === 0, dup.join(', '));
  }

  console.log('\n== A DELEGAÇÃO SE COMPORTA COMO O onclick ==');
  // O arquivo de verdade, como módulo inline, numa página em branco. A única
  // linha acrescentada entrega acoes() ao teste.
  const fonte = lerFonte('src/shared/ui/acoes.js') + '\nwindow.__acoes = acoes;';
  const b = await chromium.launch();
  const p = await b.newPage();
  const erros = [];
  p.on('pageerror', e => erros.push(e.message));
  await p.setContent(`
    <div id="fora" data-acao="fora">
      <div id="meio" data-acao="meio">
        <button id="dentro" data-acao="dentro"><span id="icone">x</span></button>
        <button id="isolado" data-acao="isolado">y</button>
      </div>
    </div>
    <ul id="lista" data-acao="lista"><li><button id="redesenha" data-acao="redesenha">r</button></li></ul>
    <input id="campo" data-acao-enter="enter" data-acao-keydown="tecla">
    <div id="caixa" data-acao-focus="foco"><input id="dentro-da-caixa" data-acao-focus="foco"></div>
    <div id="pai-change" data-acao-change="paiMudou"><select id="sel" data-acao-change="mudou"><option>1</option></select></div>
    <button id="sem-registro" data-acao="naoExiste">z</button>
    <button id="args" data-acao="args" data-id="O'Brien &quot;&amp;&quot; Cia">a</button>
  `);
  await p.addScriptTag({ type: 'module', content: fonte });
  await p.waitForFunction(() => typeof window.__acoes === 'function');
  await p.evaluate(() => {
    window.__log = [];
    const log = n => (el, ev) => window.__log.push(n + (ev ? ':' + ev.type : ''));
    window.__acoes({
      fora: log('fora'),
      meio: log('meio'),
      dentro: log('dentro'),
      isolado: (el, ev) => {
        ev.stopPropagation();
        window.__log.push('isolado');
      },
      lista: log('lista'),
      redesenha: () => {
        document.getElementById('lista').innerHTML = '<li>novo</li>';
        window.__log.push('redesenha');
      },
      enter: log('enter'),
      tecla: log('tecla'),
      foco: el => window.__log.push('foco#' + el.id),
      mudou: log('mudou'),
      paiMudou: log('paiMudou'),
      args: el => window.__log.push(el.dataset.id)
    });
    // ouvinte comum num ancestral: o onclick com stopPropagation o calava
    document.getElementById('fora').addEventListener('click', () => window.__log.push('ouvinte-fora'));
  });
  const rodada = async fn => {
    await p.evaluate(() => (window.__log = []));
    await fn();
    return p.evaluate(() => window.__log.join(' '));
  };

  let r = await rodada(() => p.click('#icone'));
  checa(
    'aninhadas rodam de dentro para fora, e o ouvinte comum depois',
    r === 'dentro:click meio:click fora:click ouvinte-fora',
    r
  );
  r = await rodada(() => p.click('#isolado'));
  checa('stopPropagation cala as de fora e o ouvinte comum', r === 'isolado', r);
  r = await rodada(() => p.click('#redesenha'));
  checa('a tela redesenhada no meio do clique não perde o ancestral', r === 'redesenha lista:click', r);
  r = await rodada(() => p.press('#campo', 'a'));
  checa('tecla comum: só keydown', r === 'tecla:keydown', r);
  r = await rodada(() => p.press('#campo', 'Enter'));
  checa('Enter: keydown e depois data-acao-enter', r === 'tecla:keydown enter:keydown', r);
  r = await rodada(() => p.focus('#dentro-da-caixa'));
  checa('focus não sobe: só a ação do próprio campo', r === 'foco#dentro-da-caixa', r);
  r = await rodada(() => p.selectOption('#sel', '1').then(() => p.dispatchEvent('#sel', 'change')));
  checa('change de verdade sobe até o pai, como o inline', r.startsWith('mudou:change paiMudou:change'), r);
  r = await rodada(() =>
    p.evaluate(() => document.getElementById('sel').dispatchEvent(new Event('change', { bubbles: false })))
  );
  checa('change disparado sem bolha fica no próprio alvo', r === 'mudou:change', r);
  r = await rodada(() => p.click('#args'));
  checa('o argumento chega inteiro, com aspas e &', r === 'O\'Brien "&" Cia', r);

  erros.length = 0;
  await p.click('#sem-registro');
  await p.waitForTimeout(50);
  checa(
    'ação sem registro aparece como erro, em vez de não fazer nada calada',
    erros.some(e => /naoExiste/.test(e)),
    erros.join(' | ')
  );
  const dup = await p.evaluate(() => {
    try {
      window.__acoes({ fora: () => {} });
      return 'aceitou';
    } catch (e) {
      return e.message;
    }
  });
  checa('registrar o mesmo nome duas vezes é recusado', /duas vezes/.test(dup), dup);
  await b.close();

  process.exit(resumo([]) ? 1 : 0);
})();
