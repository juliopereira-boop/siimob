// Documento obrigatório.
//
// O gestor marca um tipo em Configurações › Tipos de documento e, a partir daí,
// o processo não avança de etapa sem ele. Quem TRANCA é o banco
// (trg_a1_cases_guarda_documento e a1_pa_transicionar); a tela avisa O QUE
// falta, que é o que o gestor precisa para resolver.
//
// A verificação que mais importa é a de NÃO-REGRESSÃO: com nenhum tipo marcado
// — a situação de todo cliente hoje — nada muda, nem uma requisição a mais.
// Sem isso, este recurso teria travado a esteira de quem nunca pediu por ele.
const { abrir, checa, resumo } = require('./comum');

const TIPOS = [
  { id:'t1', name:'RG',  module:'repasse', active:true, obrigatorio:true },
  { id:'t2', name:'CPF', module:'repasse', active:true },
  { id:'t3', name:'Contrato', module:'repasse', active:false, obrigatorio:true },  // inativo não obriga
];

const patchDeEtapa = p => p.evaluate(() =>
  (window.__POSTS || []).filter(x => x.m === 'PATCH' && /a1_cases/.test(x.url)
                                  && /stage_id/.test(x.body || '')));

(async () => {
  const todosErros = [];

  // ── Sem nada marcado: nada muda ──────────────────────────────────────────
  {
    const { b, p, erros } = await abrir('repasse.html');
    console.log('\n== SEM TIPO OBRIGATÓRIO, A ESTEIRA ANDA COMO SEMPRE ==');
    await p.evaluate(() => { window.__POSTS = []; });
    const antes = await p.evaluate(() => G.cases.find(c => c.stage_id) || null);
    checa('a base falsa tem processo para mover', !!antes);
    await p.evaluate(async () => {
      const c = G.cases.find(x => x.stage_id);
      const outra = G.stages.find(s => s.id !== c.stage_id);
      await moveCard(c.id, outra.id);
    });
    await p.waitForTimeout(700);
    checa('o processo foi movido', (await patchDeEtapa(p)).length === 1);
    todosErros.push(...erros);
    await b.close();
  }

  // ── Com um tipo obrigatório e o processo sem ele ─────────────────────────
  {
    const { b, p, erros } = await abrir('repasse.html', { docTypes: TIPOS });
    console.log('\n== COM TIPO OBRIGATÓRIO, AVANÇAR SEM O DOCUMENTO É BARRADO ==');

    // Duas etapas de verdade, com posição, para que "avançar" e "voltar" sejam
    // coisas diferentes — sem isso o teste passaria sem provar a direção.
    const etapas = await p.evaluate(() => G.stages.map(s => ({ id:s.id, name:s.name, position:s.position })));
    checa('as etapas da base falsa têm posição', etapas.length > 1 && etapas[0].position != null,
          JSON.stringify(etapas.slice(0,2)));

    const alvo = await p.evaluate(() => {
      const ord = [...G.stages].sort((a,b) => a.position - b.position);
      const c = G.cases.find(x => x.stage_id === ord[0].id) || G.cases[0];
      // Garante o cenário: processo na primeira etapa e sem documento nenhum.
      c.stage_id = ord[0].id; c.documents = [];
      return { caso:c.id, de:ord[0].id, frente:ord[1].id };
    });

    await p.evaluate(() => { window.__POSTS = []; });
    await p.evaluate(a => moveCard(a.caso, a.frente), alvo);
    await p.waitForTimeout(700);
    checa('nada foi gravado', (await patchDeEtapa(p)).length === 0);
    const aviso = await p.evaluate(() => (document.getElementById('toast-wrap') || {}).textContent || '');
    checa('e a tela diz qual documento falta', /RG/.test(aviso), aviso.trim().slice(0,120));
    checa('sem citar o tipo que não é obrigatório', !/CPF/.test(aviso), aviso.trim().slice(0,120));
    checa('nem o tipo inativo', !/Contrato/.test(aviso), aviso.trim().slice(0,120));

    console.log('\n-- voltar de etapa continua livre --');
    await p.evaluate(a => { const c = G.cases.find(x => x.id === a.caso); c.stage_id = a.frente; }, alvo);
    await p.evaluate(() => { window.__POSTS = []; });
    await p.evaluate(a => moveCard(a.caso, a.de), alvo);
    await p.waitForTimeout(700);
    checa('voltar sem o documento passa', (await patchDeEtapa(p)).length === 1);

    console.log('\n-- com o documento anexado, avança --');
    await p.evaluate(a => {
      const c = G.cases.find(x => x.id === a.caso);
      c.stage_id = a.de;
      c.documents = [{ id:'d1', type:'RG', name:'rg.pdf' }];
    }, alvo);
    await p.evaluate(() => { window.__POSTS = []; });
    await p.evaluate(a => moveCard(a.caso, a.frente), alvo);
    await p.waitForTimeout(700);
    checa('com o documento, o processo avança', (await patchDeEtapa(p)).length === 1);

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  // ── A marcação em Configurações ──────────────────────────────────────────
  {
    const { b, p, erros } = await abrir('configuracoes.html', { docTypes: TIPOS });
    console.log('\n== CONFIGURAÇÕES: MARCAR O TIPO COMO OBRIGATÓRIO ==');
    await p.evaluate(() => openCfgView('doctypes'));
    await p.waitForTimeout(600);

    const cab = await p.$$eval('#cfg-view-doctypes thead th', els => els.map(e => e.textContent.trim()));
    checa('a tabela ganhou a coluna Obrigatório', cab.includes('Obrigatório'), cab.join(' | '));

    const marcados = await p.$$eval('#dt-tbody input[type=checkbox]', els => els.map(e => e.checked));
    checa('o RG já vem marcado e o CPF não', marcados[0] === true && marcados[1] === false,
          JSON.stringify(marcados));

    await p.evaluate(() => { window.__POSTS = []; });
    await p.evaluate(() => toggleDocTypeObrigatorio('t2'));   // CPF passa a ser obrigatório
    await p.waitForTimeout(600);
    const gravado = await p.evaluate(() => {
      const x = (window.__POSTS || []).filter(y => /a1_config/.test(y.url)).pop();
      try { return JSON.parse(JSON.parse(x.body).value); } catch { return null; }
    });
    const cpf = (gravado || []).find(t => t && t.id === 't2');
    checa('gravou obrigatorio no CPF', cpf && String(cpf.obrigatorio) === 'true', JSON.stringify(cpf));
    const rg = (gravado || []).find(t => t && t.id === 't1');
    checa('e não mexeu no RG', rg && String(rg.obrigatorio) === 'true', JSON.stringify(rg));
    const msg = await p.evaluate(() => (document.getElementById('toast-wrap') || {}).textContent || '');
    checa('o aviso explica a consequência, não diz só "salvo"',
          /não avança/.test(msg), msg.trim().slice(0,120));

    checa('nenhum XSS executou', await p.evaluate(() => window.__XSS) === 0);
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros));
})();
