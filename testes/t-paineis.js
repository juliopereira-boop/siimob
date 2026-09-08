// Seletor de painel do Dashboard e os painéis executivos de Pré-análise e
// Comercial (js/paineis.js).
//
// A primeira seção é a que não se negocia: o cliente que só tem Repasse — que é
// TODO cliente hoje — precisa ver o Dashboard exatamente como sempre viu. Sem
// seletor, sem painel de módulo carregado e sem uma única consulta às tabelas
// dos módulos novos. O resto do arquivo só existe para provar que, quando a
// licença está liberada, o que aparece é o painel certo e sem dado pessoal.
const { abrir, checa, resumo } = require('./comum');

// Dado pessoal que o Supabase de mentira devolve dentro das linhas dos módulos
// novos. Nada disso pode chegar a uma tela executiva — nem no texto, nem num
// title=, nem escondido no HTML.
const CPFS   = ['52998224725', '11144477735', '12345678909'];
const NOMES  = ['Maria Titular', 'Pedro Titular', 'Joana Associada'];
const CAMPOS = ['renda_declarada', 'renda_analisada', 'renda_familiar', 'pessoa_id', 'participantes'];

// Lê os cartões de KPI de um painel como pares rótulo → valor.
async function lerKpis(p, id) {
  return p.evaluate(sel => Array.from(document.querySelectorAll(sel + ' .kpi-card')).map(c => ({
    rot: (c.querySelector('.kpi-label') || {}).textContent.trim(),
    val: (c.querySelector('.kpi-value') || {}).textContent.trim(),
    sub: ((c.querySelector('.kpi-sub') || {}).textContent || '').trim()
  })), '#' + id);
}
function kpi(lista, rotulo) {
  const k = lista.find(x => x.rot === rotulo);
  return k ? k.val : '(cartão ausente: ' + rotulo + ')';
}

(async () => {
  const todosErros = [];

  console.log('== CLIENTE SÓ COM REPASSE: NADA MUDA ==');
  {
    const { b, p, erros } = await abrir('repasse.html');

    checa('o seletor de painel não fica visível',
      !(await p.locator('#seletor-painel').isVisible()));
    checa('e nenhum botão de painel chegou a ser desenhado',
      (await p.locator('#seletor-painel-botoes button').count()) === 0);
    checa('o painel de módulo continua escondido e vazio',
      !(await p.locator('#painel-modulo').isVisible())
      && (await p.locator('#painel-modulo').innerHTML()).trim() === '');
    checa('o dashboard do Repasse continua no lugar',
      await p.locator('#painel-repasse').isVisible());
    checa('e continua carregando os números de sempre',
      /\d/.test(await p.locator('#kpi-total').textContent()));
    checa('nenhuma tabela dos módulos novos foi consultada',
      await p.evaluate(() => !performance.getEntriesByType('resource')
        .some(r => /a1_pre_analises|a1_comerciais|a1_pa_|a1_co_/.test(r.name))));
    checa('nenhum XSS', (await p.evaluate(() => window.__XSS || 0)) === 0);
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== O WRAPPER NÃO QUEBROU A TELA ==');
  {
    // Um </div> fora de lugar num arquivo de 330 KB não aparece num teste que
    // só olha texto: o navegador conserta a marcação em silêncio e os blocos
    // seguintes vão parar dentro do wrapper. Aqui a prova é de parentesco.
    const { b, p, erros } = await abrir('repasse.html');
    checa('#painel-repasse está dentro da aba Dashboard',
      await p.evaluate(() => {
        const d = document.getElementById('tab-dashboard');
        const r = document.getElementById('painel-repasse');
        return !!d && !!r && d.contains(r);
      }));
    checa('os KPIs e a agenda do Repasse ficaram DENTRO do wrapper',
      await p.evaluate(() => {
        const r = document.getElementById('painel-repasse');
        return ['kpi-total', 'gargalo-list', 'agenda-calendar', 'tempo-etapa-list']
          .every(id => { const e = document.getElementById(id); return e && r.contains(e); });
      }));
    checa('e as outras abas ficaram FORA dele',
      await p.evaluate(() => {
        const r = document.getElementById('painel-repasse');
        return ['tab-repasse', 'tab-dashboard'].every(id => !r.contains(document.getElementById(id)));
      }));
    checa('esconder o wrapper esconde o dashboard inteiro, e só ele',
      await p.evaluate(() => {
        const r = document.getElementById('painel-repasse');
        r.style.display = 'none';
        const escondeu = document.getElementById('kpi-total').offsetParent === null;
        const sobrou = document.getElementById('tab-repasse') !== null;
        r.style.display = '';
        return escondeu && sobrou;
      }));
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== COM OS TRÊS MÓDULOS, O SELETOR APARECE ==');
  {
    const { b, p, erros } = await abrir('repasse.html', { modulos: ['PRE_ANALISE', 'COMERCIAL'] });

    checa('o seletor de painel aparece', await p.locator('#seletor-painel').isVisible());
    const ordem = await p.$$eval('#seletor-painel-botoes button', bs => bs.map(x => x.textContent.trim()));
    checa('com os botões na ordem da jornada: Pré-análise, Comercial, Repasse',
      JSON.stringify(ordem) === JSON.stringify(['Pré-análise', 'Comercial', 'Repasse']),
      JSON.stringify(ordem));
    checa('e abre no Repasse, que é onde o cliente já trabalhava',
      (await p.locator('#painel-repasse').isVisible())
      && !(await p.locator('#painel-modulo').isVisible()));

    // ── Pré-análise ──
    await p.click('#seletor-painel-botoes button[data-painel="PRE_ANALISE"]');
    await p.waitForSelector('#pn-kpis-pa', { timeout: 5000 });
    await p.waitForTimeout(400);

    checa('clicar em Pré-análise esconde o dashboard do Repasse',
      !(await p.locator('#painel-repasse').isVisible()));
    checa('e mostra o painel do módulo', await p.locator('#painel-modulo').isVisible());

    const pa = await lerKpis(p, 'pn-kpis-pa');
    checa('o painel desenha os oito KPIs da Pré-análise', pa.length === 8, 'foram ' + pa.length);
    checa('entradas no período conta as 4 pré-análises', kpi(pa, 'Entradas no período') === '4',
      kpi(pa, 'Entradas no período'));
    checa('ativas conta as 4 — a aprovada sem Comercial continua na conta',
      kpi(pa, 'Pré-análises ativas') === '4', kpi(pa, 'Pré-análises ativas'));
    // 2 aprovadas e 1 reprovada decididas no período; a EM_ANALISE fica fora.
    checa('a taxa de aprovação conta uma decisão por pré-análise',
      kpi(pa, 'Taxa de aprovação') === '67%', kpi(pa, 'Taxa de aprovação'));
    // 4 ativas, 2 em situação sem sla_horas: o denominador é 2, e 1 estourou.
    checa('o SLA vencido só divide por quem tem prazo cadastrado',
      kpi(pa, 'SLA vencido') === '50%', kpi(pa, 'SLA vencido'));
    checa('e diz quantas ficaram de fora por não ter prazo',
      /2 ativa\(s\) sem prazo definido/.test(await p.evaluate(() =>
        Array.from(document.querySelectorAll('#pn-kpis-pa .kpi-card'))
          .find(c => /SLA vencido/.test(c.textContent)).getAttribute('title'))));
    checa('a pendência documental mede sobre as ativas',
      kpi(pa, 'Pendência documental') === '25%', kpi(pa, 'Pendência documental'));
    checa('o reenvio mede sobre quem já enviou alguma coisa',
      kpi(pa, 'Reenvio documental') === '33%', kpi(pa, 'Reenvio documental'));
    // 2 elegíveis (aprovada + titular), 1 virou comercial.
    checa('a conversão para o Comercial usa a regra de a1_pa_pode_criar_comercial',
      kpi(pa, 'Conversão → Comercial') === '50%', kpi(pa, 'Conversão → Comercial'));

    const funilPA = await p.locator('#pn-funil-pa').textContent();
    checa('o funil da Pré-análise sai na ordem contratada',
      /Pré-análise criada[\s\S]*Dossiê sem pendência[\s\S]*Decisão de crédito concluída[\s\S]*Decisão aprovada e válida[\s\S]*Elegível ao Comercial[\s\S]*Comercial criado/.test(funilPA));
    checa('e o que não tem carimbo de tempo no banco fica sem tempo, não estimado',
      (funilPA.match(/—/g) || []).length >= 3, funilPA.slice(0, 120));

    checa('o painel diz o que NÃO dá para calcular hoje',
      /Depende de cadastro que ainda não existe/.test(await p.locator('#painel-modulo').textContent()));
    checa('e não promete meta nem forecast',
      !/forecast|cobertura de pipeline: \d/i.test(await p.locator('#pn-kpis-pa').textContent()));

    // ── Privacidade ──
    const htmlPA = await p.locator('#painel-modulo').innerHTML();
    checa('nenhum CPF chega ao painel executivo',
      !CPFS.some(c => htmlPA.includes(c)) && !/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(htmlPA)
      && !/\b\d{11}\b/.test(htmlPA));
    checa('nem nome de pessoa', !NOMES.some(n => htmlPA.includes(n)));
    checa('nem renda individual', !CAMPOS.some(cp => htmlPA.includes(cp))
      && !/4\.500|2\.200|3\.000|3\.800/.test(htmlPA));
    checa('e a fila mostra o processo, não a pessoa',
      /Empreendimento/.test(htmlPA) && !/Titular|CPF/.test(htmlPA));

    // Trocar o período é aritmética sobre o que já está na mão: não pode
    // disparar consulta nova nem quebrar o desenho.
    const antes = await p.evaluate(() => performance.getEntriesByType('resource').length);
    await p.selectOption('#painel-modulo .pn-periodo', '30'); await p.waitForTimeout(500);
    checa('trocar o período redesenha sem ir ao servidor de novo',
      (await p.evaluate(() => performance.getEntriesByType('resource').length)) === antes);
    checa('e o painel continua de pé', (await p.locator('#pn-kpis-pa .kpi-card').count()) === 8);

    // ── Comercial ──
    await p.click('#seletor-painel-botoes button[data-painel="COMERCIAL"]');
    await p.waitForSelector('#pn-kpis-co', { timeout: 5000 });
    await p.waitForTimeout(400);

    const co = await lerKpis(p, 'pn-kpis-co');
    checa('o painel Comercial desenha os oito KPIs', co.length === 8, 'foram ' + co.length);
    checa('comerciais ativos conta o negócio aberto', kpi(co, 'Comerciais ativos') === '1',
      kpi(co, 'Comerciais ativos'));
    checa('o pipeline sai em reais, a partir dos centavos do banco',
      /R\$\s?260\.000/.test(kpi(co, 'Pipeline bruto')), kpi(co, 'Pipeline bruto'));
    checa('e é rotulado como soma de valores abertos, não previsão',
      /não é previsão/.test((co.find(x => x.rot === 'Pipeline bruto') || {}).sub || ''));
    checa('sem contrato assinado, o ticket médio é um traço e não um zero',
      kpi(co, 'Ticket médio') === '—', kpi(co, 'Ticket médio'));
    // A esteira do cliente falso não tem situação com flag CANCELADO.
    checa('sem situação de cancelamento na esteira, o win rate não inventa 100%',
      kpi(co, 'Win rate') === '—', kpi(co, 'Win rate'));
    checa('e o painel explica o cadastro que falta',
      /esteira sem situação de cancelamento/.test((co.find(x => x.rot === 'Win rate') || {}).sub || ''));
    checa('o aging usa o relógio da situação',
      kpi(co, 'Aging do pipeline') === '2d', kpi(co, 'Aging do pipeline'));
    checa('e aponta o SLA estourado',
      /1 com SLA estourado/.test((co.find(x => x.rot === 'Aging do pipeline') || {}).sub || ''));
    checa('ninguém passou pela etapa de criar repasse: a conversão é um traço',
      kpi(co, 'Conversão → Repasse') === '—', kpi(co, 'Conversão → Repasse'));

    const htmlCO = await p.locator('#painel-modulo').innerHTML();
    checa('o snapshot de origem não vaza participante para a tela executiva',
      !NOMES.some(n => htmlCO.includes(n)) && !CAMPOS.some(cp => htmlCO.includes(cp)));
    checa('nem CPF', !CPFS.some(c => htmlCO.includes(c)) && !/\b\d{11}\b/.test(htmlCO));

    // ── Voltar para o Repasse ──
    await p.click('#seletor-painel-botoes button[data-painel="repasse"]');
    await p.waitForTimeout(400);
    checa('voltar para Repasse traz o dashboard de volta',
      await p.locator('#painel-repasse').isVisible());
    checa('com os números ainda carregados',
      /\d/.test(await p.locator('#kpi-total').textContent()));
    checa('e o painel de módulo sai da tela e é descarregado',
      !(await p.locator('#painel-modulo').isVisible())
      && (await p.locator('#painel-modulo').innerHTML()).trim() === '');

    checa('nenhum XSS', (await p.evaluate(() => window.__XSS || 0)) === 0);
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  console.log('\n== SÓ UM DOS DOIS MÓDULOS NOVOS ==');
  {
    // Com Pré-análise e Repasse, o seletor tem duas opções e o cartão de
    // conversão para o Comercial não pode aparecer: sem o módulo, a1_comerciais
    // não devolve linha e o cartão marcaria 0% numa operação que nem tem a etapa.
    const { b, p, erros } = await abrir('repasse.html', { modulos: ['PRE_ANALISE'] });
    const ordem = await p.$$eval('#seletor-painel-botoes button', bs => bs.map(x => x.textContent.trim()));
    checa('o seletor traz só Pré-análise e Repasse',
      JSON.stringify(ordem) === JSON.stringify(['Pré-análise', 'Repasse']), JSON.stringify(ordem));

    await p.click('#seletor-painel-botoes button[data-painel="PRE_ANALISE"]');
    await p.waitForSelector('#pn-kpis-pa', { timeout: 5000 });
    await p.waitForTimeout(400);
    const pa = await lerKpis(p, 'pn-kpis-pa');
    checa('sem o Comercial, o cartão de conversão não é desenhado',
      pa.length === 7 && !pa.some(x => /Conversão/.test(x.rot)), JSON.stringify(pa.map(x => x.rot)));
    checa('e a tabela do Comercial não é consultada',
      await p.evaluate(() => !performance.getEntriesByType('resource')
        .some(r => /a1_comerciais|a1_co_/.test(r.name))));
    checa('nenhum XSS', (await p.evaluate(() => window.__XSS || 0)) === 0);
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros) ? 1 : 0);
})();
