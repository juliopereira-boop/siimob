// A imobiliária do corretor dentro do "Meu perfil".
//
// O pedido do dono: "estou na tela do corretor. O botão Perfil, ao abrir o
// popup, nas informações, deve constar a imobiliária que ele está vinculado,
// sem poder alterar, só ver."
//
// O vínculo mora em a1_partners.extra.imobiliaria_id — gravado pelo gestor em
// Configurações › Corretores e pelo pré-cadastro por link. Quem escolhe é o
// gestor; o corretor confere. Por isso o campo é somente leitura e o salvamento
// não pode mandar imobiliária nenhuma.
//
// Duas coisas que este teste existe para não deixar apodrecer:
//
// 1. O campo mostra NOME, não id. Guardar 'p1' e mostrar 'p1' seria pior que
//    não mostrar nada — o corretor leria um código que não significa nada.
// 2. Quem NÃO tem vínculo não ganha campo. Campo vazio é pior que campo
//    ausente: parece cadastro pela metade que a pessoa poderia preencher, e
//    ela não pode. Ana Souza (p3) é corretora sem imobiliária no cadastro — a
//    situação da maioria hoje — e é ela que prova esse lado.
//
// E as TRÊS telas do Repasse são conferidas, não uma. Elas são cópias, com a
// mesma função openProfile() repetida três vezes: correção em uma esquece as
// outras, e foi exatamente assim que a dívida de triplicação já mordeu antes.
const { chromium } = require('playwright');
const { responder, liberarModulos } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);

const PAGINAS = ['repasse.html', 'andamento.html', 'listagem.html'];

// Carla Dias tem extra.imobiliaria_id='p1' na base falsa, e p1 é a "Imob Alfa"
// (cujo nome carrega a carga de XSS de aspa — de propósito).
const CARLA = { id:'p10', tenant_id:'t1', name:'Carla Dias', role:'partner',
                type:'corretor', cpf:'66666666666', permissions:{} };
// Sem imobiliária nenhuma no cadastro.
const ANA   = { id:'p3', tenant_id:'t1', name:'Ana Souza', role:'partner',
                type:'corretor', cpf:'33333333333', permissions:{} };

async function abrirComo(pag, usuario) {
  liberarModulos([]);                       // como todo cliente de hoje
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1400, height: 950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  await p.addInitScript(u => {
    localStorage.setItem('a1_token','tok'); localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify(u));
    window.__XSS = 0;
    window.confirm = () => true;
    window.__POSTS = [];
    const f = window.fetch;
    window.fetch = function(url, o){
      if (o && o.method && o.method !== 'GET') window.__POSTS.push({url:String(url), m:o.method, body:o.body});
      return f.apply(this, arguments);
    };
  }, usuario);
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r => {
    let d; try { d = responder(r.request().url(), r.request().method(), r.request().postData()); } catch { d = []; }
    r.fulfill({status:200,contentType:'application/json',headers:{'content-range':'0-1/2'},body:JSON.stringify(d)});
  });
  await p.goto(BASE + '/' + pag, { waitUntil:'load' });
  await p.waitForTimeout(1800);
  return { b, p, erros };
}

// Abre o perfil pelo caminho de verdade: o botão que o corretor clica.
async function abrirPerfil(p) {
  await p.click('#btn-profile');
  await p.waitForTimeout(700);
}

// Visível de verdade, não só presente no DOM.
const visivel = (p, sel) => p.evaluate(s => {
  const el = document.querySelector(s);
  if (!el) return false;
  return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
}, sel);

const textoDoModal = p => p.evaluate(() => {
  const m = document.getElementById('modal-profile-bg');
  return m ? m.innerText : '';
});

(async () => {
  const todosErros = [];

  for (const pag of PAGINAS) {
    // ── O corretor COM imobiliária vê o nome dela, e só vê ──────────────────
    {
      const { b, p, erros } = await abrirComo(pag, CARLA);
      console.log(`\n== ${pag} — CORRETOR COM IMOBILIÁRIA (Carla Dias) ==`);

      checa('o botão Perfil aparece para o corretor', await visivel(p, '#btn-profile'));
      await abrirPerfil(p);

      checa('o perfil tem o campo Imobiliária', await p.locator('#prof-imob').count() === 1);
      checa('e ele está visível', await visivel(p, '#prof-imob'));

      const valor = await p.inputValue('#prof-imob').catch(() => '');
      checa('mostra o NOME da imobiliária', /Imob Alfa/.test(valor), 'valor=' + valor);
      checa('não mostra o id cru do cadastro', !/^p\d+$/.test(valor.trim()), 'valor=' + valor);
      checa('não mostra "undefined"', !/undefined/i.test(valor), 'valor=' + valor);

      const travado = await p.evaluate(() => {
        const el = document.getElementById('prof-imob');
        return !!el && (el.disabled || el.readOnly);
      });
      checa('o campo é somente leitura — quem define é o gestor', travado);

      // "Sem poder alterar" também significa que o salvamento não manda o
      // vínculo de volta. Se um dia o campo virar editável sem querer, é aqui
      // que o teste grita antes de o corretor se mudar sozinho de imobiliária.
      await p.evaluate(() => { window.__POSTS = []; });
      await p.click('#prof-save-btn');
      await p.waitForTimeout(700);
      const corpo = await p.evaluate(() => {
        const x = (window.__POSTS || []).find(y => /a1_partners/.test(y.url) && y.m === 'PATCH');
        return x ? x.body : null;
      });
      checa('salvar o perfil continua mandando o nome', corpo && /Carla Dias/.test(corpo), String(corpo));
      checa('e não manda imobiliária nenhuma',
            corpo && !/imobiliaria|extra/i.test(corpo), String(corpo));

      checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
      todosErros.push(...erros);
      await b.close();
    }

    // ── Quem NÃO tem vínculo não vê campo vazio ─────────────────────────────
    {
      const { b, p, erros } = await abrirComo(pag, ANA);
      console.log(`\n== ${pag} — CORRETOR SEM IMOBILIÁRIA (Ana Souza) ==`);

      await abrirPerfil(p);
      checa('o perfil abriu', await visivel(p, '#prof-name'));
      checa('sem vínculo, o campo Imobiliária não aparece', !(await visivel(p, '#prof-imob')));

      const txt = await textoDoModal(p);
      checa('nem o rótulo "Imobiliária" sobra na tela', !/Imobili/i.test(txt), txt.replace(/\n/g,' | '));
      checa('e nada de "undefined" no popup', !/undefined/i.test(txt), txt.replace(/\n/g,' | '));

      checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
      todosErros.push(...erros);
      await b.close();
    }
  }

  process.exit(resumo(todosErros));
})();
