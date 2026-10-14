// Busca por nome/CPF: "o cliente está cadastrado e não aparece".
//
// O relato de produção (THE CRED, 14/10): a operação digitava o nome do
// cliente no filtro e ele não aparecia, embora estivesse cadastrado. A busca
// comparava o texto exatamente como digitado. Nos dados da THE CRED, 236 de
// 307 CPFs estão gravados com pontos e traço: quem buscava pelos onze números
// não achava três em cada quatro processos. E "joao" não achava JOÃO.
//
// O processo de prova é injetado na memória da página, e não no andaime
// compartilhado: nome com acento e CPF pontuado mudariam o resultado de
// asserções de outras suítes que nada têm a ver com busca.
const { abrir, checa, resumo } = require('./comum');

const ACHAR = [
  ['joao conceicao',  'sem acento'],
  ['CONCEIÇÃO joão',  'palavras fora de ordem e em maiúsculas'],
  ['12345678909',     'CPF só com os dígitos, gravado com pontuação'],
  ['123.456.789-09',  'CPF digitado com pontuação'],
  ['joao  da   conceicao', 'espaços a mais na digitação'],
];
const NAO_ACHAR = [
  ['joaquim',  'outro nome'],
  ['1234509',  'dígitos que não estão em sequência em campo nenhum'],
];

(async () => {
  const todosErros = [];
  for (const pag of ['andamento.html', 'listagem.html', 'repasse.html']) {
    console.log(`\n${pag}`);
    const { b, p, erros } = await abrir(pag);
    await p.evaluate(() => {
      const etapa = (G.stages && G.stages[0] && G.stages[0].id) || null;
      G.cases.unshift({ id:'cz', tenant_id:'t1', module_key:'repasse', stage_id:etapa,
        stage_name:'', client_name:'JOÃO  DA CONCEIÇÃO', client_cpf:'123.456.789-09',
        development:'Residencial Alfa', partner_name:'', manager_name:'', broker_name:'',
        real_estate_name:'', payload:{}, archived:false, created_at:new Date().toISOString() });
      G.currentGroup = '__all__';
    });
    for (const [q, porque] of ACHAR) {
      const r = await p.evaluate(q => {
        G.filters.search = q;
        const quadro = filteredCases().some(c => c.id === 'cz');
        G.dashFilters = Object.assign({}, G.dashFilters || {}, { search: q });
        const painel = typeof dashCases === 'function' ? dashCases().some(c => c.id === 'cz') : true;
        return { quadro, painel };
      }, q);
      checa(`acha "${q}" (${porque}) no quadro e na listagem`, r.quadro === true);
      checa(`acha "${q}" (${porque}) no dashboard`, r.painel === true);
    }
    for (const [q, porque] of NAO_ACHAR) {
      const r = await p.evaluate(q => { G.filters.search = q; return filteredCases().some(c => c.id === 'cz'); }, q);
      checa(`não acha "${q}" (${porque})`, r === false);
    }
    // E pela caixa de verdade, que é como a pessoa busca.
    // A caixa mora no painel de filtros, que nasce recolhido; o evento de
    // digitação é disparado nela mesmo, e é ele que aciona o tratador da tela.
    if (await p.locator('#f-search').count()) {
      await p.evaluate(() => {
        G.filters.search = '';
        const el = document.getElementById('f-search');
        el.value = 'joao conceicao';
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await p.waitForTimeout(300);
      checa('digitando na caixa de busca, o processo aparece na tela',
        await p.evaluate(() => filteredCases().some(c => c.id === 'cz') && G.filters.search === 'joao conceicao'));
    }
    checa('nada de XSS', await p.evaluate(() => window.__XSS || 0) === 0);
    todosErros.push(...erros);
    await b.close();
  }
  process.exit(resumo(todosErros));
})();
