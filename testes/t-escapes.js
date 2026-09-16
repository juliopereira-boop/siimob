// esc() e escJs() — o que cada uma protege, e o que a outra não protege.
//
// POR QUE ESTE ARQUIVO EXISTE
// Duas coisas diferentes foram corrigidas nas telas do Repasse e nenhuma tinha
// prova:
//
// 1. `String(s||'')` APAGAVA O ZERO. esc(0) devolvia string vazia, e a tela
//    mostrava campo em branco onde o dado era 0 — unidade "0", contagem zero,
//    marca false. O teste do valor tem de ser por ausência, não por falsy.
//
// 2. `onclick="f('${esc(x)}')"` NUNCA ESTEVE PROTEGIDO. esc() transforma a
//    aspa simples em nada (ela não está na lista) e, mesmo que a
//    transformasse em `&#39;`, não adiantaria: o parser de HTML decodifica a
//    entidade de volta para `'` ANTES de o JavaScript ler o atributo. Quem
//    escapa para dentro de string JS tem de escapar no nível do JS — e só
//    depois no nível do atributo. É o que escJs faz, nessa ordem.
//    Isto não é hipótese: `selectGroup('${...}')` interpola um nome de
//    regional que o gestor DIGITA em Configurações.
//
// Aqui não há navegador: as funções são lidas dos arquivos de verdade, e a
// decodificação do atributo é refeita à mão, nas duas etapas em que o
// navegador a faz. Copiar as funções para o teste provaria a cópia.
const fs = require('fs');
const path = require('path');
const { checa, resumo } = require('./comum');

const RAIZ = path.join(__dirname, '..');
const lerArq = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');

// Extrai as declarações de esc/escJs do arquivo e as avalia. Um arquivo pode
// ter mais de uma declaração de esc (superadmin.html tem duas, no mesmo escopo
// global): todas são avaliadas na ordem em que aparecem, como o navegador faz,
// e vale a última — se uma delas ficar para trás numa correção, é aqui que se
// descobre.
function funcoesDe(arquivo) {
  const s = lerArq(arquivo);
  const decls = [];
  const re = /function (esc|escJs)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(s))) {
    // fecha a chave contando profundidade — as funções contêm `{` em regex? não,
    // mas contêm `}` dentro de nada; a contagem simples basta e é verificável.
    let i = re.lastIndex - 1, prof = 0;
    do { if (s[i] === '{') prof++; else if (s[i] === '}') prof--; i++; } while (prof > 0 && i < s.length);
    decls.push(s.slice(m.index, i));
  }
  if (!decls.length) return null;
  return new Function(decls.join('\n') + '\n;return { esc, escJs: typeof escJs === "function" ? escJs : null };')();
}

// ── O navegador, nas duas etapas ────────────────────────────────────────────
// 1. O parser de HTML lê o valor do atributo e decodifica as entidades.
function decodificaAtributo(v) {
  return v.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
          .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
}
// 2. Só então o JavaScript do atributo é compilado. O que chega à função é o
//    resultado de interpretar o literal de string — é isto que precisa voltar
//    igual ao dado original.
function oQueAFuncaoRecebe(jsDoAtributo) {
  let visto = null;
  new Function('f', jsDoAtributo)(x => { visto = x; });
  return visto;
}

const ATAQUES = [
  "Zona Norte",                       // o caso normal: nome de regional
  "a'); alert(1);//",                 // fecha a string e o argumento
  "a\\'); alert(1);//",               // já vem com barra: a barra também escapa
  "O'Brien & Cia",                    // aspa legítima em nome próprio
  'x"); alert(2);//',                 // aspa dupla, que fecha o ATRIBUTO
  "</script><script>alert(3)</script>",
  "linha1\nlinha2",
  "&#39;); alert(4);//"               // a entidade escrita à mão pelo atacante
];

const TELAS = ['repasse.html', 'andamento.html', 'listagem.html'];
const TODAS = TELAS.concat(['configuracoes.html', 'registro.html', 'registro-listagem.html', 'superadmin.html']);

(async () => {

console.log('== esc() NÃO PODE ENGOLIR O ZERO ==');
for (const arq of TODAS) {
  const F = funcoesDe(arq);
  if (!F) { checa(arq + ': tem esc()', false, 'nenhuma declaração encontrada'); continue; }
  checa(arq + ': esc(0) devolve "0"', F.esc(0) === '0', JSON.stringify(F.esc(0)));
  checa(arq + ': esc(false) devolve "false"', F.esc(false) === 'false', JSON.stringify(F.esc(false)));
  checa(arq + ': esc(null) e esc(undefined) continuam vazios',
    F.esc(null) === '' && F.esc(undefined) === '', JSON.stringify([F.esc(null), F.esc(undefined)]));
  checa(arq + ': e a marcação continua escapada',
    F.esc('<b>"x"&</b>') === '&lt;b&gt;&quot;x&quot;&amp;&lt;/b&gt;', F.esc('<b>"x"&</b>'));
}

console.log('\n== escJs() SOBREVIVE ÀS DUAS DECODIFICAÇÕES ==');
for (const arq of TELAS) {
  const F = funcoesDe(arq);
  checa(arq + ': tem escJs()', !!F.escJs);
  if (!F.escJs) continue;
  let todosOk = true, primeiroErro = '';
  for (const dado of ATAQUES) {
    // Exatamente o formato que as telas geram.
    const atributo = `f('${F.escJs(dado)}')`;
    let recebido;
    try { recebido = oQueAFuncaoRecebe(decodificaAtributo(atributo)); }
    catch (e) { recebido = '(não compilou: ' + e.message + ')'; }
    if (recebido !== dado) {
      todosOk = false;
      if (!primeiroErro) primeiroErro = JSON.stringify(dado) + ' virou ' + JSON.stringify(recebido);
    }
  }
  checa(arq + ': o dado chega inteiro à função, em todos os ataques', todosOk, primeiroErro);
  // A aspa dupla também tem de estar escapada como entidade, senão o ATRIBUTO
  // fecha antes do onclick terminar e o resto vira marcação.
  checa(arq + ': a aspa dupla sai como entidade, e não fecha o atributo',
    !F.escJs('x"); alert(2);//').includes('"'), F.escJs('x"); alert(2);//'));
}

console.log('\n== NENHUM onclick INTERPOLA COM esc() ==');
// A regressão que este bloco pega: alguém acrescenta um botão novo copiando um
// vizinho antigo e volta a usar esc() dentro de string JS. O padrão é buscado
// no arquivo cru, não no resultado — é o código que precisa estar certo.
for (const arq of TELAS) {
  const s = lerArq(arq);
  // `onclick="algo('${esc(` — esc seguido de parêntese, não escJs.
  const ruins = [...s.matchAll(/onclick="[^"]*\('\$\{esc\(/g)]
    .filter(m => {
      // O trecho dentro do próprio comentário que explica o problema não conta.
      const linha = s.slice(s.lastIndexOf('\n', m.index) + 1, s.indexOf('\n', m.index));
      return !/^\s*\/\//.test(linha);
    });
  checa(arq + ': nenhuma interpolação em string JS usa esc()', ruins.length === 0,
    ruins.length + ' ocorrência(s)');
  checa(arq + ': e os sítios que existem usam escJs()',
    (s.match(/onclick="[^"]*\('\$\{escJs\(/g) || []).length >= 4,
    String((s.match(/onclick="[^"]*\('\$\{escJs\(/g) || []).length));
}

process.exit(resumo([]) ? 1 : 0);
})();
