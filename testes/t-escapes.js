// esc(): o que ele protege, e por que um escape só basta.
//
// POR QUE ESTE ARQUIVO EXISTE
// Duas coisas foram corrigidas nas telas do Repasse e nenhuma tinha prova:
//
// 1. `String(s||'')` APAGAVA O ZERO. esc(0) devolvia string vazia, e a tela
//    mostrava campo em branco onde o dado era 0 — unidade "0", contagem zero,
//    marca false. O teste do valor tem de ser por ausência, não por falsy.
//
// 2. `onclick="f('${esc(x)}')"` NUNCA ESTEVE PROTEGIDO: o parser de HTML
//    decodifica a entidade de volta para `'` ANTES de o JavaScript ler o
//    atributo. Isto não era hipótese: `selectGroup('${...}')` interpolava um
//    nome de regional que o gestor DIGITA em Configurações. Primeiro veio um
//    segundo escape (escJs, JS por baixo e HTML por cima); desde a fase 3b não
//    há mais onclick: o argumento vai num data-* (data-acao, ver
//    src/shared/ui/acoes.js), que o navegador só decodifica, e esc() basta.
//
// Aqui não há navegador: a função é lida do arquivo de verdade, e a
// decodificação do atributo é refeita à mão, como o navegador a faz. Copiar a
// função para o teste provaria a cópia.
const { checa, resumo } = require('./comum');

const { lerFonte, lerPagina } = require('./fonte');
const lerArq = f => (/^[\w-]+\.html$/.test(f) ? lerPagina(f) : lerFonte(f));

// Extrai as declarações de esc do arquivo e as avalia. Um arquivo pode
// ter mais de uma declaração de esc (superadmin.html tem duas, no mesmo escopo
// global): todas são avaliadas na ordem em que aparecem, como o navegador faz,
// e vale a última — se uma delas ficar para trás numa correção, é aqui que se
// descobre.
function funcoesDe(arquivo) {
  const s = lerArq(arquivo);
  const decls = [];
  const re = /function (esc)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    // fecha a chave contando profundidade — as funções contêm `{` em regex? não,
    // mas contêm `}` dentro de nada; a contagem simples basta e é verificável.
    let i = re.lastIndex - 1,
      prof = 0;
    do {
      if (s[i] === '{') prof++;
      else if (s[i] === '}') prof--;
      i++;
    } while (prof > 0 && i < s.length);
    decls.push(s.slice(m.index, i));
  }
  if (!decls.length) return null;
  return new Function(decls.join('\n') + '\n;return { esc };')();
}

// ── O navegador ─────────────────────────────────────────────────────────────
// O parser de HTML lê o valor do atributo e decodifica as entidades.
function decodificaAtributo(v) {
  return v
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}
const ATAQUES = [
  'Zona Norte', // o caso normal: nome de regional
  "a'); alert(1);//", // fecha a string e o argumento
  "a\\'); alert(1);//", // já vem com barra: a barra também escapa
  "O'Brien & Cia", // aspa legítima em nome próprio
  'x"); alert(2);//', // aspa dupla, que fecha o ATRIBUTO
  '</script><script>alert(3)</script>',
  'linha1\nlinha2',
  '&#39;); alert(4);//' // a entidade escrita à mão pelo atacante
];

// Desde a fase 2 da reestruturação o escape é UM só: src/shared/utils/texto.js.
// Antes cada tela tinha o seu, em quatro versões (só duas escapavam a aspa
// simples). O que se confere agora: a função única faz o certo, e TODA tela que
// desenha dado do banco a carrega e não redefine a própria.
const ESCAPE = 'src/shared/utils/texto.js';
const TELAS_COM_ESC = [
  'comercial',
  'configuracoes',
  'crm',
  'geral',
  'importar',
  'indica',
  'pre-analise',
  'registro',
  'repasse',
  'superadmin',
  'tenant-admin',
  'workflow'
];

(async () => {
  console.log('== esc() NÃO PODE ENGOLIR O ZERO ==');
  const F = funcoesDe(ESCAPE);
  checa('o arquivo de escape declara esc()', !!F && typeof F.esc === 'function');
  checa('esc(0) devolve "0"', F.esc(0) === '0', JSON.stringify(F.esc(0)));
  checa('esc(false) devolve "false"', F.esc(false) === 'false', JSON.stringify(F.esc(false)));
  checa(
    'esc(null) e esc(undefined) continuam vazios',
    F.esc(null) === '' && F.esc(undefined) === '',
    JSON.stringify([F.esc(null), F.esc(undefined)])
  );
  checa(
    'e a marcação continua escapada',
    F.esc('<b>"x"&</b>') === '&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;',
    F.esc('<b>"x"&</b>')
  );
  checa('e a aspa simples também (atributo entre aspas simples)', F.esc("a'b") === 'a&#39;b', F.esc("a'b"));

  console.log('\n== O ARGUMENTO EM data-* CHEGA INTEIRO À AÇÃO ==');
  let todosOk = true,
    primeiroErro = '';
  for (const dado of ATAQUES) {
    // Exatamente o formato que as telas geram: data-id="${esc(x)}".
    const atributo = F.esc(dado);
    const recebido = decodificaAtributo(atributo);
    if (recebido !== dado) {
      todosOk = false;
      if (!primeiroErro) primeiroErro = JSON.stringify(dado) + ' virou ' + JSON.stringify(recebido);
    }
  }
  checa('o dado chega inteiro, em todos os ataques', todosOk, primeiroErro);
  checa(
    'e nenhum deles fecha o atributo',
    ATAQUES.every(d => !F.esc(d).includes('"')),
    F.esc('x"); alert(2);//')
  );

  console.log('\n== TODA TELA USA O ESCAPE ÚNICO ==');
  for (const tela of TELAS_COM_ESC) {
    const html = lerFonte(`src/pages/${tela}/index.html`);
    const js = lerFonte(`src/pages/${tela}/main.js`);
    // Módulo ES: a tela carrega só o main.js, e o escape chega por import.
    checa(
      `${tela}: importa o escape único`,
      html.includes(`<script type="module" src="/src/pages/${tela}/main.js">`) &&
        /^import \{[^}]*\besc\b[^}]*\} from '\.\.\/\.\.\/shared\/utils\/texto\.js';$/m.test(js)
    );
    checa(`${tela}: e não redefine esc()`, !/^(function\s+esc\b|(const|let|var)\s+esc\s*=)/m.test(js));
  }

  process.exit(resumo([]) ? 1 : 0);
})();
