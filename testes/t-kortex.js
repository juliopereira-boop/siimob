// Selo "Um Produto Kortex" em todas as páginas.
//
// Prova: cada página do sistema tem #kortex-selo, com o texto "Um Produto
// Kortex" e "Kortex" em <b>; o selo não recebe cliques (pointer-events:none),
// fica fixo no canto inferior direito, some na impressão e não duplica; no
// site, quando o botão do WhatsApp aparece no canto, o selo vai para a esquerda
// dele, sem ficar por baixo.
const fs = require('fs');
const path = require('path');
const { abrir, checa, resumo } = require('./comum');

const PAGINAS = [
  '',
  'login',
  'contato',
  'privacidade',
  'thecred/dashboard',
  'thecred/crm',
  'thecred/configuracoes',
  'thecred/repasse',
  'thecred/registro',
  'thecred/pre-analise'
];

(async () => {
  const todos = [];

  console.log('== Toda página inclui o selo ==');
  const sem = fs
    .readdirSync(path.join(__dirname, '..', 'src', 'pages'))
    .filter(d => fs.existsSync(path.join(__dirname, '..', 'src', 'pages', d, 'index.html')))
    .filter(
      d =>
        !fs
          .readFileSync(path.join(__dirname, '..', 'src', 'pages', d, 'index.html'), 'utf8')
          .includes('src="/kortex.js"')
    );
  checa('as páginas de src/pages incluem /kortex.js', sem.length === 0, sem.join(', '));

  for (const pag of PAGINAS) {
    const { b, p, erros } = await abrir(pag, { modulos: ['crm', 'PRE_ANALISE', 'registro', 'repasse'] });
    const s = await p.evaluate(() => {
      const el = document.getElementById('kortex-selo');
      if (!el) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        texto: el.textContent.trim(),
        b: el.querySelector('b') && el.querySelector('b').textContent,
        pe: cs.pointerEvents,
        pos: cs.position,
        z: Number(cs.zIndex),
        direita: window.innerWidth - r.right,
        baixo: window.innerHeight - r.bottom,
        quantos: document.querySelectorAll('#kortex-selo').length,
        // com o WhatsApp flutuante do site visível, o selo fica à esquerda dele
        zap: (() => {
          const z = document.getElementById('zap');
          return !!z && !z.hidden && r.right <= z.getBoundingClientRect().left;
        })()
      };
    });
    checa(
      `/${pag}: selo no canto inferior direito, sem receber cliques`,
      !!s &&
        s.texto === 'Um Produto Kortex' &&
        s.b === 'Kortex' &&
        s.pe === 'none' &&
        s.pos === 'fixed' &&
        s.z >= 10000 &&
        s.quantos === 1 &&
        (s.zap || s.direita <= 20) &&
        s.baixo <= 20,
      JSON.stringify(s)
    );
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Site: desvia do botão do WhatsApp ==');
  {
    const { b, p, erros } = await abrir('');
    await p.evaluate(() => {
      const z = document.getElementById('zap');
      z.hidden = false;
    });
    await p.waitForTimeout(1700);
    const r = await p.evaluate(() => {
      const s = document.getElementById('kortex-selo').getBoundingClientRect();
      const z = document.getElementById('zap').getBoundingClientRect();
      return { seloDireita: s.right, zapEsquerda: z.left, seloBaixo: s.bottom, zapBaixo: z.bottom };
    });
    checa(
      'o selo fica à esquerda do botão, alinhado pela base',
      r.seloDireita <= r.zapEsquerda && Math.abs(r.seloBaixo - r.zapBaixo) <= 2,
      JSON.stringify(r)
    );
    // incluir de novo não duplica
    await p.addScriptTag({ url: '/kortex.js' });
    checa('incluir o script duas vezes não duplica', (await p.$$('#kortex-selo')).length === 1);
    await p.emulateMedia({ media: 'print' });
    checa(
      'some na impressão',
      await p.evaluate(() => getComputedStyle(document.getElementById('kortex-selo')).display === 'none')
    );
    await b.close();
    todos.push(...erros);
  }

  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
