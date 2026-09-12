// "Arquivar" arquivava apagando.
//
// O botão do rodapé do cartão mandava DELETE em a1_cases, dizia "Arquivado" e
// destruía o cartão na tela. Sem conferir a resposta, sem trilha, sem volta.
// Quem clicava achava que tinha GUARDADO o processo — e tinha apagado o
// processo, o histórico de etapas e os eventos junto (as filhas caem por
// ON DELETE CASCADE). É quase certamente a origem do relato "não consigo
// excluir cartão": conseguia, e não voltava.
//
// Em `listagem.html` o mesmo defeito tinha escala: "Excluir selecionados"
// mandava um DELETE em lote atrás de um confirm de uma linha.
//
// O que esta suíte prova, e por que cada verificação existe:
//
//   · NENHUM DELETE sai das três telas. É a verificação central, e é negativa
//     de propósito: o dublê aqui ACEITA o DELETE e responde 200. Se a tela
//     ainda apagasse, tudo pareceria funcionar — o toast diria "Arquivado" e o
//     cartão sumiria. A prova tem de ser a ausência da requisição.
//   · o que sai é PATCH {archived:true}, que é o que registro.html já fazia;
//   · a recusa do banco NÃO vira "Arquivado" na tela (era o caso do res.ok que
//     ninguém conferia: 403 do RLS e o cartão sumia da lista mesmo assim);
//   · dá para VER e DESARQUIVAR o que foi arquivado — arquivar sem conseguir
//     reabrir é apagar com outro nome;
//   · e a listagem por padrão pede archived=eq.false, senão o arquivado
//     continuaria à vista e "arquivar" não faria nada visível.
//
// A segunda metade cobre os três vínculos por id — empresa correspondente,
// usuário correspondente e analista — que passam a ser gravados ao lado das
// colunas de texto antigas. A verificação que mais importa ali também é
// negativa: o texto histórico NÃO pode ser apagado pelo vínculo novo.
//
// As três telas são cópias com muita lógica repetida (está na skill). Por isso
// quase tudo aqui roda em `repasse.html`, `andamento.html` e `listagem.html` —
// correção em uma esquece as outras, e foi assim que este defeito sobreviveu.
const { chromium } = require('playwright');
const { responder, D, XSS } = require('./fake');
const { checa, resumo } = require('./comum');
const BASE = 'http://localhost:' + (process.env.PORTA_TESTE || 8099);
const PAGINAS = ['repasse.html', 'andamento.html', 'listagem.html'];

// Os processos do dublê compartilhado, mais um JÁ arquivado. O arquivado leva o
// XSS plantado porque ele aparece numa tela nova — a lista de arquivados — e
// tela nova é onde o escape costuma faltar.
function baseCasos() {
  const casos = D.cases.map(c => ({ ...c, archived: false }));
  casos.push({
    id:'c9', tenant_id:'t1', module_key:'repasse', stage_id:'s2', stage_name:'Análise',
    client_name:'Cliente Arquivado ' + XSS, client_cpf:'11144477735',
    development:'Parque das Águas', partner_name:'Correspondente A', archived:true,
    created_at:'2026-06-01T10:00:00Z', stage_entered_at:'2026-06-01T10:00:00Z', payload:{}
  });
  return casos;
}

// Dublê próprio: o compartilhado não conhece `archived` e não guarda o que a
// tela grava. Sem guardar, "arquivei e sumiu da lista" passaria com a tela
// fazendo nada, porque a releitura devolveria os mesmos dados de sempre.
async function abrir(pag, { falharPatch = false } = {}) {
  const casos   = baseCasos();
  const pedidos = [];   // tudo que não é GET — é aqui que o DELETE apareceria
  const urls    = [];   // toda URL pedida — é aqui que o filtro archived aparece

  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{ width:1400, height:950 } });
  const erros = [];
  p.on('pageerror', e => erros.push('JS: ' + e.message));
  p.on('console', m => { const t = m.text();
    if (m.type()==='error' && !/ERR_CONNECTION|ERR_TUNNEL|fonts\.g|favicon|net::|403|400/.test(t))
      erros.push('console: ' + t); });

  await p.addInitScript(() => {
    localStorage.setItem('a1_token','tok');
    localStorage.setItem('a1_slug','thecred');
    localStorage.setItem('a1_user', JSON.stringify(
      {id:'u1',tenant_id:'t1',name:'Julio',role:'owner',cpf:'99999999999'}));
    window.__XSS = 0;
    // O texto do confirm é parte do que se conserta: o antigo ("Arquivar este
    // repasse?") era vago sobre algo que na prática não tinha volta.
    window.__CONFIRMS = [];
    window.confirm = m => { window.__CONFIRMS.push(String(m)); return true; };
  });
  await p.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({status:200,contentType:'text/css',body:''}));
  await p.route(/supabase\.co/, r => {
    const req = r.request(), u = req.url(), m = req.method(), corpo = req.postData();
    urls.push(m + ' ' + u);
    if (m !== 'GET') pedidos.push({ m, u, corpo });

    if (/\/a1_cases/.test(u)) {
      const qs = u.split('?')[1] || '';
      if (m === 'GET') {
        let r2 = casos;
        const arq = /archived=eq\.(true|false)/.exec(qs);
        if (arq) r2 = r2.filter(c => String(!!c.archived) === arq[1]);
        const id = /(?:^|[?&])id=eq\.([a-z0-9-]+)/.exec(qs);
        if (id) r2 = r2.filter(c => c.id === id[1]);
        const sel = /select=([^&]*)/.exec(qs);
        if (sel) {
          const cols = decodeURIComponent(sel[1]).split(',').map(s => s.split(':').pop().trim());
          r2 = r2.map(c => { const o = {}; for (const k of cols) if (k in c) o[k] = c[k]; return o; });
        }
        return r.fulfill({ status:200, contentType:'application/json',
          headers:{ 'content-range': `0-${Math.max(r2.length-1,0)}/${r2.length}` },
          body: JSON.stringify(r2) });
      }
      if (m === 'PATCH') {
        // A recusa do RLS, que é o que acontece com quem não pode editar.
        if (falharPatch) return r.fulfill({ status:403, contentType:'application/json',
          body: JSON.stringify({ message:'new row violates row-level security policy for table "a1_cases"' }) });
        const id     = /(?:^|[?&])id=eq\.([a-z0-9-]+)/.exec(qs);
        const dentro = /(?:^|[?&])id=in\.\(([^)]*)\)/.exec(qs);
        const alvo = id ? [id[1]] : dentro ? decodeURIComponent(dentro[1]).split(',') : [];
        let corpoJson = {}; try { corpoJson = JSON.parse(corpo || '{}'); } catch {}
        for (const c of casos) if (alvo.includes(c.id)) Object.assign(c, corpoJson);
        return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
      }
      // DELETE cai aqui e o banco ACEITA. É de propósito: com o dublê
      // recusando, uma tela que ainda apagasse falharia por causa do erro, e
      // não por estar apagando. A prova é a ausência do DELETE em `pedidos`.
      return r.fulfill({ status:200, contentType:'application/json', body:'[]' });
    }

    let d; try { d = responder(u, m, corpo); } catch { d = []; }
    r.fulfill({ status:200, contentType:'application/json',
      headers:{ 'content-range':'0-1/2' }, body: JSON.stringify(d) });
  });

  await p.goto(BASE + '/' + pag, { waitUntil:'load' });
  await p.waitForTimeout(1700);
  return { b, p, erros, casos, pedidos, urls };
}

const deletes  = pedidos => pedidos.filter(x => x.m === 'DELETE' && /a1_cases/.test(x.u));
const patchArq = (pedidos, valor) => pedidos.filter(x =>
  x.m === 'PATCH' && /a1_cases/.test(x.u) && new RegExp(`"archived"\\s*:\\s*${valor}`).test(x.corpo || ''));
const idsNaTela   = p => p.evaluate(() => (G.cases || []).map(c => c.id));
const desenhado   = p => p.evaluate(() => (document.getElementById('kanban-board')?.innerHTML || '') +
                                          (document.getElementById('cases-tbody')?.innerHTML || ''));
const toastsDaTela= p => p.evaluate(() => [...document.querySelectorAll('#toast-wrap .toast')]
                                            .map(t => t.className + '|' + t.textContent));

(async () => {
  const todosErros = [];

  // ── 1. O defeito central: arquivar não pode apagar ───────────────────────
  console.log('\nArquivar grava archived=true — e nenhum DELETE sai da tela');
  for (const pag of PAGINAS) {
    const { b, p, erros, casos, pedidos } = await abrir(pag);
    await p.evaluate(() => openCard('c1'));
    await p.waitForTimeout(500);
    await p.click('#mc-arquivar').catch(() => {});
    await p.waitForTimeout(700);

    checa(`${pag}: nenhum DELETE em a1_cases`, deletes(pedidos).length === 0,
          deletes(pedidos).map(x => x.u).join(' '));
    checa(`${pag}: saiu PATCH archived=true`, patchArq(pedidos, 'true').length === 1);
    checa(`${pag}: o PATCH é do processo aberto`,
          patchArq(pedidos, 'true').some(x => /id=eq\.c1/.test(x.u)));
    checa(`${pag}: o processo continua no banco, agora arquivado`,
          !!casos.find(c => c.id === 'c1' && c.archived === true));
    checa(`${pag}: e sai da lista da tela`, !(await idsNaTela(p)).includes('c1'));
    checa(`${pag}: ficou trilha do arquivamento em a1_events`,
          pedidos.some(x => x.m === 'POST' && /a1_events/.test(x.u) && /arquiv/i.test(x.corpo || '')));
    todosErros.push(...erros); await b.close();
  }

  // ── 2. O texto que a pessoa lê antes de confirmar ────────────────────────
  // O confirm antigo era "Arquivar este repasse?" — vago sobre uma ação que
  // naquele momento era irreversível. Confere conteúdo, não tamanho.
  console.log('\nO confirm e o botão dizem o que de fato acontece');
  {
    const { b, p, erros } = await abrir('repasse.html');
    const rotulo = await p.evaluate(() => document.getElementById('mc-arquivar')?.textContent || '');
    checa('o rótulo do botão avisa que o cartão sai da lista', /sai da lista/i.test(rotulo), rotulo);
    await p.evaluate(() => openCard('c1'));
    await p.waitForTimeout(400);
    await p.click('#mc-arquivar').catch(() => {});
    await p.waitForTimeout(500);
    const texto = (await p.evaluate(() => window.__CONFIRMS.join('\n'))) || '';
    checa('o confirm diz que NÃO é apagado', /não é apagado|nao e apagado/i.test(texto), texto.slice(0,120));
    checa('o confirm ensina o caminho de volta', /desarquiv/i.test(texto));
    checa('o confirm manda quem quer apagar mesmo para a Exclusão definitiva',
          /exclus[ãa]o definitiva/i.test(texto));
    todosErros.push(...erros); await b.close();
  }

  // ── 3. A recusa do banco não pode virar "Arquivado" ──────────────────────
  // Era o res.ok que ninguém conferia. Com 403 do RLS, a tela dizia "Arquivado"
  // e tirava o cartão da lista — e o processo seguia lá, intacto, para quem
  // recarregasse a página.
  console.log('\nBanco recusa: a tela não pode dizer que arquivou');
  for (const pag of PAGINAS) {
    const { b, p, erros, pedidos } = await abrir(pag, { falharPatch:true });
    await p.evaluate(() => openCard('c1'));
    await p.waitForTimeout(500);
    await p.click('#mc-arquivar').catch(() => {});
    await p.waitForTimeout(700);
    const toasts = await toastsDaTela(p);
    checa(`${pag}: avisa o erro`, toasts.some(t => /toast-error/.test(t)), toasts.join(' / '));
    checa(`${pag}: não anuncia sucesso`, !toasts.some(t => /toast-success/.test(t) && /rquivad/.test(t)));
    checa(`${pag}: o cartão continua na lista`, (await idsNaTela(p)).includes('c1'));
    checa(`${pag}: e nenhum DELETE de consolo`, deletes(pedidos).length === 0);
    todosErros.push(...erros); await b.close();
  }

  // ── 4. Ver e desarquivar ─────────────────────────────────────────────────
  // Arquivar sem conseguir reabrir é apagar com outro nome.
  console.log('\nO que foi arquivado se vê e volta');
  for (const pag of PAGINAS) {
    const { b, p, erros, casos, pedidos, urls } = await abrir(pag);

    checa(`${pag}: Arquivados não fica no cabeçalho global`,
          await p.evaluate(() => !document.querySelector('.hdr #btn-arquivados')));
    checa(`${pag}: a lista pede só os ativos`,
          urls.some(u => /a1_cases\?.*archived=eq\.false/.test(u)));
    checa(`${pag}: o arquivado não aparece por padrão`, !(await idsNaTela(p)).includes('c9'));
    checa(`${pag}: e o ativo aparece`, (await idsNaTela(p)).includes('c1'));

    await p.click('#btn-arquivados').catch(() => {});
    await p.waitForTimeout(900);
    checa(`${pag}: o botão "Ver arquivados" existe e troca a lista`,
          (await idsNaTela(p)).includes('c9'));
    checa(`${pag}: e tira os ativos de vista`, !(await idsNaTela(p)).includes('c1'));
    checa(`${pag}: pediu archived=eq.true ao banco`,
          urls.some(u => /a1_cases\?.*archived=eq\.true/.test(u)));
    checa(`${pag}: o arquivado é desenhado`, /Cliente Arquivado/.test(await desenhado(p)));

    await p.evaluate(() => openCard('c9'));
    await p.waitForTimeout(500);
    const verDesarquivar = await p.evaluate(() => {
      const el = document.getElementById('mc-desarquivar');
      return !!el && getComputedStyle(el).display !== 'none';
    });
    checa(`${pag}: o cartão arquivado oferece Desarquivar`, verDesarquivar);
    await p.click('#mc-desarquivar').catch(() => {});
    await p.waitForTimeout(700);
    checa(`${pag}: saiu PATCH archived=false`, patchArq(pedidos, 'false').length === 1);
    checa(`${pag}: e o processo voltou no banco`,
          !!casos.find(c => c.id === 'c9' && c.archived === false));
    checa(`${pag}: nenhum DELETE em todo o caminho`, deletes(pedidos).length === 0);
    checa(`${pag}: o nome do arquivado não executou nada`,
          await p.evaluate(() => window.__XSS === 0));
    todosErros.push(...erros); await b.close();
  }

  // ── 5. O lote da listagem ────────────────────────────────────────────────
  // Mesmo defeito, escala pior: um DELETE de N processos atrás de um confirm
  // de uma linha.
  console.log('\nlistagem.html: o lote arquiva, não exclui');
  {
    const { b, p, erros, casos, pedidos } = await abrir('listagem.html');
    checa('o botão "Excluir selecionados" não existe mais',
          await p.evaluate(() => !document.querySelector('[onclick="bulkDelete()"]')));
    await p.evaluate(() => {
      document.querySelectorAll('#cases-tbody .row-chk').forEach(cb => { cb.checked = true; toggleRowSel(cb.value, cb); });
    });
    await p.waitForTimeout(200);
    await p.click('#bulk-arquivar').catch(() => {});
    await p.waitForTimeout(800);

    checa('nenhum DELETE em lote', deletes(pedidos).length === 0,
          deletes(pedidos).map(x => x.u).join(' '));
    const lote = patchArq(pedidos, 'true').filter(x => /id=in\./.test(x.u));
    checa('saiu um PATCH archived=true em lote', lote.length === 1);
    checa('o lote pegou mais de um processo', /id=in\.\([^)]*,/.test(lote[0]?.u || ''));
    checa('e todos ficaram arquivados no banco',
          ['c1','c2','c3','c4'].every(id => casos.find(c => c.id === id)?.archived === true));
    const confirmado = await p.evaluate(() => window.__CONFIRMS.join('\n'));
    checa('o confirm do lote também diz que não apaga',
          /não são apagados|nao sao apagados/i.test(confirmado), confirmado.slice(0,120));
    todosErros.push(...erros); await b.close();
  }

  // ── 6. Os três vínculos por id ───────────────────────────────────────────
  // empresa correspondente, usuário correspondente e analista deixam de ser só
  // um nome. O id é o vínculo novo; o texto continua gravado e continua sendo o
  // histórico — e é isso que a última verificação defende.
  console.log('\nEmpresa correspondente, usuário correspondente e analista viram vínculo');
  for (const pag of PAGINAS) {
    const { b, p, erros, pedidos } = await abrir(pag);

    // Formulário de processo novo.
    await p.evaluate(() => openNewCase());
    await p.waitForTimeout(900);
    const valores = await p.evaluate(() => ({
      empresa: [...document.getElementById('n-partner').options].map(o => o.value),
      usuario: [...document.getElementById('n-usuario').options].map(o => o.value),
      analista:[...document.getElementById('n-manager').options].map(o => o.value),
    }));
    checa(`${pag}: o seletor de empresa correspondente oferece o id do cadastro`,
          valores.empresa.includes('e1'), valores.empresa.join(','));
    checa(`${pag}: o de usuário correspondente também`,
          valores.usuario.includes('p8'), valores.usuario.join(','));
    checa(`${pag}: o de analista também`,
          valores.analista.includes('p2'), valores.analista.join(','));

    await p.evaluate(() => {
      document.getElementById('n-name').value = 'Cliente do Vínculo';
      document.getElementById('n-partner').value = 'e1';
      document.getElementById('n-usuario').value = 'p8';
      document.getElementById('n-manager').value = 'p2';
      createCase();
    });
    await p.waitForTimeout(800);
    const post = pedidos.find(x => x.m === 'POST' && /a1_cases/.test(x.u));
    const corpo = post ? JSON.parse(post.corpo) : {};
    checa(`${pag}: grava empresa_id`,        corpo.empresa_id === 'e1',        JSON.stringify(corpo.empresa_id));
    checa(`${pag}: grava correspondente_id`, corpo.correspondente_id === 'p8', JSON.stringify(corpo.correspondente_id));
    checa(`${pag}: grava analista_id`,       corpo.analista_id === 'p2',       JSON.stringify(corpo.analista_id));
    // O texto continua valendo: é por ele que os filtros e os painéis de hoje
    // enxergam o processo. Gravar só o id deixaria o repasse novo fora de todos.
    checa(`${pag}: e continua gravando o nome da empresa`,
          corpo.partner_name === 'Empresa Corr ' + require('./fake').ASPA, JSON.stringify(corpo.partner_name));
    checa(`${pag}: e o nome do analista`, corpo.manager_name === 'João Analista', JSON.stringify(corpo.manager_name));

    // Cartão de um processo ANTIGO: tem texto, não tem vínculo. Salvar não pode
    // apagar o texto — é o histórico de quem estava no processo, e há nome em
    // produção que não existe mais em cadastro nenhum.
    await p.evaluate(() => { closeModal('modal-new-bg'); openCard('c1'); });
    await p.waitForTimeout(700);
    await p.evaluate(() => saveCase());
    await p.waitForTimeout(800);
    const patch = pedidos.filter(x => x.m === 'PATCH' && /a1_cases\?id=eq\.c1/.test(x.u))
                         .map(x => { try { return JSON.parse(x.corpo); } catch { return {}; } })
                         .find(x => 'client_name' in x) || {};
    checa(`${pag}: o cartão antigo preserva o texto do correspondente`,
          patch.partner_name === 'Correspondente A', JSON.stringify(patch.partner_name));
    checa(`${pag}: e o texto do analista`,
          patch.manager_name === 'João Analista', JSON.stringify(patch.manager_name));
    checa(`${pag}: e o cartão sabe mandar os três vínculos`,
          'empresa_id' in patch && 'correspondente_id' in patch && 'analista_id' in patch,
          Object.keys(patch).join(','));
    checa(`${pag}: nada foi apagado no caminho`, deletes(pedidos).length === 0);
    todosErros.push(...erros); await b.close();
  }

  process.exit(resumo(todosErros));
})();
