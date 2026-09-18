// Seletor de painel do Dashboard e os painéis executivos de Pré-análise e
// Venda (js/paineis.js).
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

  console.log('\n== AUTORIZAÇÃO ESTÁVEL DO DASHBOARD ==');
  {
    const corretor={id:'p3',tenant_id:'t1',name:'Ana Souza',role:'partner',type:'corretor',permissions:{ver_repasses:true}};
    const {b,p,erros}=await abrir('repasse.html',{usuario:corretor});
    checa('sem permissão, a URL não entra e sai da tela',/\/repasse\.html$/.test(new URL(p.url()).pathname),p.url());
    checa('mostra acesso negado estável',/não possui permissão para acessar este recurso/i.test(await p.locator('#tab-dashboard').textContent()));
    checa('e não desenha os KPIs do Repasse',!(await p.locator('#kpi-total').isVisible()));
    checa('o menu não oferece o Dashboard',!(await p.locator('.sb-sub-item').allTextContents()).some(x=>/Dashboard/.test(x)));
    checa('sem erro de JS',erros.length===0,erros[0]||''); todosErros.push(...erros); await b.close();
  }
  {
    const {b,p,erros}=await abrir('repasse.html',{superadmin:true});
    checa('Superadmin abre o Dashboard do Repasse',await p.locator('#painel-repasse').isVisible());
    checa('e não recebe a mensagem de bloqueio',!/não possui permissão/.test(await p.locator('#tab-dashboard').textContent()));
    checa('sem erro de JS',erros.length===0,erros[0]||''); todosErros.push(...erros); await b.close();
  }

  console.log('\n== COM OS TRÊS MÓDULOS, O SELETOR APARECE ==');
  {
    const { b, p, erros } = await abrir('repasse.html', { modulos: ['PRE_ANALISE', 'COMERCIAL'] });

    checa('o seletor de painel aparece', await p.locator('#seletor-painel').isVisible());
    const ordem = await p.$$eval('#seletor-painel-botoes button', bs => bs.map(x => x.textContent.trim()));
    checa('com os botões na ordem da jornada: Pré-análise, Venda, Repasse',
      JSON.stringify(ordem) === JSON.stringify(['Pré-análise', 'Venda', 'Repasse']),
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
    // Nove desde que a aprovação de PRIMEIRA entrou ao lado da taxa de aprovação:
    // as duas dão o mesmo número para quem aprova na primeira e para quem aprova
    // na terceira, e é a diferença entre elas que é o retrabalho de crédito.
    checa('o painel desenha os nove KPIs da Pré-análise', pa.length === 9, 'foram ' + pa.length);
    checa('entradas no período conta as 4 pré-análises', kpi(pa, 'Entradas no período') === '4',
      kpi(pa, 'Entradas no período'));
    checa('ativas conta as 4 — a aprovada sem Venda continua na conta',
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
    checa('a conversão para a Venda usa a regra de a1_pa_pode_criar_comercial',
      kpi(pa, 'Conversão → Venda') === '50%', kpi(pa, 'Conversão → Venda'));

    const funilPA = await p.locator('#pn-funil-pa').textContent();
    checa('o funil da Pré-análise sai na ordem contratada',
      /Pré-análise criada[\s\S]*Dossiê sem pendência[\s\S]*Decisão de crédito concluída[\s\S]*Decisão aprovada e válida[\s\S]*Elegível à Venda[\s\S]*Venda criada/.test(funilPA));
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
    checa('e o painel continua de pé', (await p.locator('#pn-kpis-pa .kpi-card').count()) === 9);

    // ── Recorte manual de datas ──────────────────────────────────────────────
    // A janela rápida só tinha PISO: "últimos 30 dias" também abraçava o que
    // tivesse data no futuro, e o recorte manual não teria fim nenhum. Estas
    // asserções guardam as DUAS pontas.
    const janela = async (de, ate) => p.evaluate(([d1, d2]) => {
      PN.dias = PN_PERSONALIZADO; PN.de = d1; PN.ate = d2;
      pnDesenharPA(document.getElementById('painel-modulo'));
      return { rotulo: document.querySelector('#painel-modulo .pn-titulo small').textContent,
               entradas: (document.querySelector('#pn-kpis-pa .kpi-value') || {}).textContent };
    }, [de, ate]);

    checa('o seletor oferece escolher datas',
      (await p.$$eval('#painel-modulo .pn-periodo option', o => o.map(x => x.textContent)))
        .includes('Escolher datas'));

    // Uma janela que termina antes de tudo que existe tem de dar zero. Se der o
    // total, é porque o limite superior não está sendo aplicado — que era
    // exatamente o estado anterior.
    const passado = await janela('2020-01-01', '2020-01-31');
    checa('a ponta de cima corta: janela no passado não traz entrada nenhuma',
      passado.entradas === '0', JSON.stringify(passado));
    checa('e o título diz o recorte em data brasileira',
      /de 01\/01\/2020 a 31\/01\/2020/.test(passado.rotulo), passado.rotulo);

    // Só a ponta de baixo: fim fica aberto até agora.
    const soDe = await janela('2020-01-01', '');
    checa('só com a data inicial, o fim fica aberto e tudo volta',
      soDe.entradas === '4' && /a partir de 01\/01\/2020/.test(soDe.rotulo), JSON.stringify(soDe));

    // Datas invertidas não podem virar painel vazio com cara de "não há nada".
    const invertida = await p.evaluate(() => {
      PN.dias = PN_PERSONALIZADO; PN.de = '2026-01-01'; PN.ate = '';
      pnTrocarData('ate', '2025-06-01', 'PRE_ANALISE');
      return { de: PN.de, ate: PN.ate };
    });
    checa('data final antes da inicial arrasta a outra ponta em vez de zerar',
      invertida.de === invertida.ate, JSON.stringify(invertida));

    // Voltar para uma janela rápida tem de LIMPAR as datas: guardá-las faria o
    // painel voltar sozinho a um recorte abandonado.
    const limpou = await p.evaluate(() => {
      pnTrocarPeriodo('90', 'PRE_ANALISE');
      return { dias: PN.dias, de: PN.de, ate: PN.ate };
    });
    checa('sair do recorte manual limpa as datas guardadas',
      limpou.dias === 90 && !limpou.de && !limpou.ate, JSON.stringify(limpou));

    // ── Venda ──
    await p.click('#seletor-painel-botoes button[data-painel="COMERCIAL"]');
    await p.waitForSelector('#pn-kpis-co', { timeout: 5000 });
    await p.waitForTimeout(400);

    const co = await lerKpis(p, 'pn-kpis-co');
    // Dez para quem tem o corte de agregado: entraram vendas líquidas (bruto
    // sozinho mente para cima) e cobertura de responsável (o KPI que diz se os
    // rankings estão medindo desempenho ou preenchimento de cadastro).
    checa('o painel Venda desenha os doze KPIs', co.length === 12, 'foram ' + co.length);
    checa('o painel Venda mostra entradas e propostas preenchidas',
      kpi(co, 'Entradas no período') === '2' && kpi(co, 'Propostas preenchidas') === '2',
      JSON.stringify(co.slice(0,2)));
    checa('comerciais ativos conta o negócio aberto', kpi(co, 'Comerciais ativos') === '1',
      kpi(co, 'Comerciais ativos'));
    checa('o pipeline sai em reais, a partir dos centavos do banco',
      /R\$\s?260\.000/.test(kpi(co, 'Pipeline bruto')), kpi(co, 'Pipeline bruto'));
    checa('e é rotulado como soma de valores abertos, não previsão',
      /não é previsão/.test((co.find(x => x.rot === 'Pipeline bruto') || {}).sub || ''));
    // ANTES ISTO PROVAVA O CONTRÁRIO: "sem contrato assinado, o ticket é um
    // traço". A premissa era que só o DOCUMENTO reconhece a venda — e é
    // exatamente o que estava errado. O cenário tem um negócio (CO-002) na etapa
    // marcada com selo VENDIDO e SEM contrato nenhum cadastrado, que é o que os
    // três clientes reais fazem: arrastam o cartão e nunca preenchem o
    // documento. Para eles, o painel inteiro lia zero enquanto o quadro mostrava
    // centenas de milhares em negócios fechados.
    checa('venda ganha pelo SELO entra no ticket, sem contrato cadastrado',
      /R\$\s?212\.000/.test(kpi(co, 'Ticket médio')), kpi(co, 'Ticket médio'));
    checa('e conta como venda ganha', kpi(co, 'Vendas ganhas') === '1', kpi(co, 'Vendas ganhas'));
    checa('com o valor dela somado', /R\$\s?212\.000/.test(
      (co.find(x => x.rot === 'Vendas ganhas') || {}).sub || ''),
      (co.find(x => x.rot === 'Vendas ganhas') || {}).sub);
    // O cartão precisa DIZER que reconheceu pela esteira: é a diferença entre
    // este painel e um relatório de contratos, e quem compara os dois merece
    // achar a explicação sem perguntar.
    const _tituloGanhas = await p.evaluate(() => {
      const c = [...document.querySelectorAll('#pn-kpis-co .kpi-card')]
        .find(x => (x.querySelector('.kpi-label')||{}).textContent.trim() === 'Vendas ganhas');
      return c ? c.getAttribute('title') || '' : '';
    });
    checa('e o cartão avisa que foi a esteira que reconheceu',
      /reconhecidas pela esteira/.test(_tituloGanhas), _tituloGanhas.slice(0, 160));
    // Ganho não é aberto: o negócio da etapa selada sai do pipeline, senão o
    // "valor em aberto" soma dinheiro que já foi fechado.
    checa('e sai do pipeline, que conta só o que ainda corre',
      kpi(co, 'Comerciais ativos') === '1', kpi(co, 'Comerciais ativos'));
    // A esteira do cliente falso não tem situação com flag CANCELADO.
    checa('sem situação de cancelamento na esteira, o win rate não inventa 100%',
      kpi(co, 'Win rate') === '—', kpi(co, 'Win rate'));
    checa('e o painel explica o cadastro que falta',
      /esteira sem situação de cancelamento/.test((co.find(x => x.rot === 'Win rate') || {}).sub || ''));
    checa('o aging usa o relógio da situação',
      kpi(co, 'Aging do pipeline') === '2d', kpi(co, 'Aging do pipeline'));
    checa('e aponta o SLA estourado',
      /1 com SLA estourado/.test((co.find(x => x.rot === 'Aging do pipeline') || {}).sub || ''));
    // CO-002 alcançou a situação de destino da transição com ação CREATE_REPASS e
    // NÃO tem repasse vinculado: 0 de 1. É o caso que este cartão existe para
    // revelar — o repasse que deveria ter nascido e não nasceu — e o cenário
    // anterior (ninguém passou pela etapa) nunca chegava a exercitá-lo.
    checa('o negócio que chegou à etapa de repasse e não virou repasse aparece',
      kpi(co, 'Conversão → Repasse') === '0,0%', kpi(co, 'Conversão → Repasse'));
    checa('e o rodapé mostra a base', /0 de 1/.test(
      (co.find(x => x.rot === 'Conversão → Repasse') || {}).sub || ''),
      (co.find(x => x.rot === 'Conversão → Repasse') || {}).sub);

    const htmlCO = await p.locator('#painel-modulo').innerHTML();
    checa('o snapshot de origem não vaza participante para a tela executiva',
      !NOMES.some(n => htmlCO.includes(n)) && !CAMPOS.some(cp => htmlCO.includes(cp)));
    checa('nem CPF', !CPFS.some(c => htmlCO.includes(c)) && !/\b\d{11}\b/.test(htmlCO));

    // ── Rankings governados (bloco novo) ──
    // A decisão que estas asserções guardam: o quadro completo é de gestor,
    // coordenador e gerente; todo o resto vê só a própria linha, sob o título
    // "Minha performance". Antes desta entrega não havia ranking nenhum aqui.
    const grade = await p.locator('#painel-modulo').textContent();
    checa('a Venda ganha o quadro de rankings', /Rankings de Vendas/.test(grade));
    checa('com os três recortes contratados',
      /Corretores/.test(grade) && /Imobiliárias/.test(grade) && /Coordenadores/.test(grade),
      grade.slice(0, 200));
    // Conteúdo, não contagem: "tem três colunas" continuaria verde com as três
    // vazias, que é exatamente como um ranking quebra sem fazer barulho.
    checa('o corretor do negócio aberto aparece no ranking de corretores',
      /Ana Souza/.test(grade), grade.slice(0, 200));
    // O coordenador NÃO é coluna do comercial: sai do extra.coordenador_id do
    // corretor. Se esse pulo se perder, a coluna fica vazia e nada acusa.
    checa('e o coordenador vem pelo vínculo do corretor, não por coluna do negócio',
      /Marcos Lima/.test(grade), grade.slice(0, 200));
    // O negócio da base não tem imobiliária vinculada: o quadro tem de assumir a
    // falta, e não desenhar um primeiro lugar que não existe.
    checa('sem vínculo de imobiliária, o quadro assume a falta',
      /Sem dados vinculados no período/.test(grade));

    // A ordem é a que a legenda promete. Provado na própria função, com linhas
    // sintéticas, porque a base de teste tem um comercial só — com ele não há
    // como ordenar nada, e a asserção passaria sem provar coisa alguma.
    const ordemVolume = await p.evaluate(() => pnRank(
      [{ k:'a' }, { k:'a' }, { k:'a' }, { k:'b' }, { k:'b' }].map((x, i) => ({ ...x, ok: i >= 3 })),
      'k', { a:'Volumosa', b:'Poucas' }, () => 0, x => x.ok).map(r => r.nome));
    checa('sem dinheiro em jogo, o ranking ordena por VOLUME, como diz a legenda',
      JSON.stringify(ordemVolume) === JSON.stringify(['Volumosa', 'Poucas']), JSON.stringify(ordemVolume));
    const ordemValor = await p.evaluate(() => pnRank(
      [{ k:'a', v:10 }, { k:'b', v:1 }, { k:'b', v:1 }, { k:'b', v:1 }],
      'k', { a:'Cara', b:'Barata' }, x => x.v, () => null).map(r => r.nome));
    checa('e onde há VGV o dinheiro continua mandando na frente do volume',
      JSON.stringify(ordemValor) === JSON.stringify(['Cara', 'Barata']), JSON.stringify(ordemValor));

    // A1.user só tem getter: quem troca a pessoa é o localStorage.
    const quemVe = await p.evaluate(() => {
      const orig = localStorage.getItem('a1_user');
      const casos = {
        gestor:      { id:'u1', role:'owner' },
        coordenador: { id:'p7', role:'partner', type:'coordenador' },
        gerente:     { id:'p3', role:'partner', type:'corretor', permissions:{ gerente:true } },
        corretor:    { id:'p3', role:'partner', type:'corretor', permissions:{} },
        analista:    { id:'p2', role:'partner', type:'analista', permissions:{} }
      };
      const r = {};
      for (const k in casos) {
        localStorage.setItem('a1_user', JSON.stringify(casos[k]));
        r[k] = pnPodeVerRanking();
      }
      if (orig != null) localStorage.setItem('a1_user', orig);
      return r;
    });
    checa('gestor, coordenador e gerente veem o ranking do time',
      quemVe.gestor === true && quemVe.coordenador === true && quemVe.gerente === true,
      JSON.stringify(quemVe));
    checa('corretor e analista comuns NÃO veem o ranking do time',
      quemVe.corretor === false && quemVe.analista === false, JSON.stringify(quemVe));

    // E o desenho obedece à regra: redesenhado como corretor comum, o quadro
    // inteiro vira "Minha performance" — sem consultar nada de novo.
    const soMeu = await p.evaluate(() => {
      const orig = localStorage.getItem('a1_user'), alvo = document.getElementById('painel-modulo');
      localStorage.setItem('a1_user', JSON.stringify({ id:'p3', role:'partner', type:'corretor', permissions:{} }));
      pnDesenharCO(alvo);
      const t = alvo.textContent;
      if (orig != null) localStorage.setItem('a1_user', orig);
      pnDesenharCO(alvo);
      return t;
    });
    checa('corretor comum vê "Minha performance" no lugar do ranking do time',
      /Minha performance/.test(soMeu) && !/Rankings de Vendas/.test(soMeu), soMeu.slice(0, 160));
    // O bloco deixou de repetir o nome da pessoa de volta para ela — isso não
    // informava nada — e passou a trazer as três réguas que faltavam: o próprio
    // período anterior, a mediana ANÔNIMA do time e a conversão. Ranking em que
    // a pessoa não aparece, ou número solto sem régua, não corrige rota.
    checa('e ele recebe o próprio número, com régua em vez do próprio nome',
      /minhas vendas/.test(soMeu) && /vs\. período anterior/.test(soMeu)
      && /mediana do time/.test(soMeu) && !/Ana Souza/.test(soMeu), soMeu.slice(0, 300));
    checa('mas o quadro do time volta assim que o gestor redesenha',
      /Rankings de Vendas/.test(await p.locator('#painel-modulo').textContent()));

    // ── O corte de AGREGADO ──────────────────────────────────────────────────
    // A regra que estas asserções guardam é a que o dono escreveu: papel
    // operacional não lê o caixa consolidado do cliente. O corte de LINHA já era
    // do RLS; este é outro, e não existia — o painel somava em reais tudo que o
    // RLS entregasse, e `ver_todos_analistas` (que é o perfil-modelo Analista)
    // entrega a carteira inteira. Na prática o analista abria o painel e lia o
    // VGV e o pipeline da operação toda.
    //
    // O painel não some para quem não tem a marca: ele troca soma por
    // quantidade. Esconder o painel puniria quem precisa dele para trabalhar.
    const comoParceiro = async (u) => p.evaluate(user => {
      const alvo = document.getElementById('painel-modulo');
      const orig = localStorage.getItem('a1_user');
      localStorage.setItem('a1_user', JSON.stringify(user));
      pnDesenharCO(alvo);
      const r = { texto: alvo.textContent.replace(/\s+/g, ' '), html: alvo.innerHTML,
                  kpis: Array.from(alvo.querySelectorAll('.kpi-card .kpi-label')).map(x => x.textContent.trim()) };
      if (orig != null) localStorage.setItem('a1_user', orig);
      pnDesenharCO(alvo);
      return r;
    }, u);

    // O analista com o perfil-modelo: visão completa ligada, consolidado não.
    const analista = await comoParceiro({ id:'p2', role:'partner', type:'analista',
      permissions:{ ver_todos_analistas:true } });
    checa('analista com visão completa NÃO lê o pipeline em reais',
      !/R\$/.test(analista.texto), analista.texto.slice(0, 240));
    checa('o cartão vira contagem de negócios, não some da tela',
      analista.kpis.includes('Negócios em aberto') && !analista.kpis.includes('Pipeline bruto'),
      JSON.stringify(analista.kpis));
    checa('e o ticket médio, que só existe em dinheiro, sai da grade',
      !analista.kpis.includes('Ticket médio'), JSON.stringify(analista.kpis));
    // O que não pode aparecer é VALOR FORMATADO. A frase que explica a permissão
    // cita "R$" de propósito — procurar a sigla solta reprovaria a explicação.
    checa('a fila perde a coluna Valor inteira, não só o cabeçalho',
      !/<th[^>]*>\s*Valor\s*<\/th>/.test(analista.html)
      && !/R\$\s?[\d.]/.test(analista.html), analista.html.slice(0, 200));
    checa('e o painel diz por que, em vez de parecer quebrado',
      /Ver valores consolidados/.test(analista.html), 'sem o motivo escrito');

    // A mesma pessoa COM a marca volta a ver o consolidado. Se isto falhar, a
    // permissão não está sendo lida — e uma marca que não muda nada é pior que
    // marca ausente.
    const analistaCom = await comoParceiro({ id:'p2', role:'partner', type:'analista',
      permissions:{ ver_todos_analistas:true, ver_consolidado_financeiro:true } });
    checa('com a permissão marcada, o consolidado volta',
      /R\$\s?260\.000/.test(analistaCom.texto) && analistaCom.kpis.includes('Pipeline bruto'),
      analistaCom.texto.slice(0, 240));

    // Coordenador: ranking SIM, mas da equipe dele. Ele tem visão completa, então
    // o RLS lhe entrega a carteira toda — sem este filtro o quadro listava
    // nominalmente corretor de outro coordenador. E ninguém ranqueia o próprio
    // nível ao lado dos pares: o quadro de coordenadores é de gestor e gerente.
    const coord = await comoParceiro({ id:'p7', role:'partner', type:'coordenador',
      permissions:{ ver_todos_analistas:true, ver_consolidado_financeiro:true } });
    checa('coordenador vê ranking, e o quadro diz que é o da equipe dele',
      /Rankings da minha equipe/.test(coord.texto), coord.texto.slice(0, 240));
    checa('e o ranking de coordenadores não aparece para um coordenador',
      !/Coordenadores/.test(coord.texto), coord.texto.slice(0, 300));
    checa('o corretor vinculado a ele continua no quadro',
      /Ana Souza/.test(coord.texto), coord.texto.slice(0, 300));

    // Coordenador SEM corretor vinculado: o quadro fica vazio em vez de mostrar
    // o time do vizinho. Esta é a asserção que pega o filtro sendo removido.
    const coordVazio = await comoParceiro({ id:'p99', role:'partner', type:'coordenador',
      permissions:{ ver_todos_analistas:true, ver_consolidado_financeiro:true } });
    checa('coordenador sem equipe não herda o time de outro coordenador',
      !/Ana Souza/.test(coordVazio.texto), coordVazio.texto.slice(0, 300));

    // ── Filtro de empreendimento ─────────────────────────────────────────────
    // Filtrar só a lista principal deixaria contratos e eventos dos processos
    // EXCLUÍDOS entrando nas contas que os leem por id. E painel filtrado que
    // não avisa é como um número errado se instala: alguém lê o total e leva
    // para a reunião como o do cliente inteiro.
    const filtrado = await p.evaluate(() => {
      const alvo = document.getElementById('painel-modulo');
      const id = (PN.co.empr[0] || {}).id;
      PN.empr = 'nao-existe-este-empreendimento';
      pnDesenharCO(alvo);
      const valorKpi = rotulo => {
        const card=Array.from(alvo.querySelectorAll('#pn-kpis-co .kpi-card')).find(c=>c.querySelector('.kpi-label')?.textContent===rotulo);
        return card?.querySelector('.kpi-value')?.textContent || '';
      };
      const vazio = { kpi: valorKpi('Comerciais ativos'),
                      titulo: alvo.querySelector('.pn-titulo small').textContent,
                      html: alvo.innerHTML };
      PN.empr = id; pnDesenharCO(alvo);
      const um = valorKpi('Comerciais ativos');
      PN.empr = ''; pnDesenharCO(alvo);
      return { vazio, um, todos: valorKpi('Comerciais ativos') };
    });
    checa('empreendimento sem negócio nenhum zera o painel inteiro',
      filtrado.vazio.kpi === '0', JSON.stringify(filtrado));
    checa('e o filtro carrega junto contratos e eventos, não só a lista principal',
      !/CO-001/.test(filtrado.vazio.html), 'sobrou linha de processo filtrado fora');
    checa('o título avisa que o painel está filtrado',
      /·\s*empreendimento filtrado/.test(filtrado.vazio.titulo), filtrado.vazio.titulo);
    checa('e tirar o filtro traz tudo de volta',
      filtrado.um === '1' && filtrado.todos === '1', JSON.stringify(filtrado));

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
    // conversão para a Venda não pode aparecer: sem o módulo, a1_comerciais
    // não devolve linha e o cartão marcaria 0% numa operação que nem tem a etapa.
    const { b, p, erros } = await abrir('repasse.html', { modulos: ['PRE_ANALISE'] });
    const ordem = await p.$$eval('#seletor-painel-botoes button', bs => bs.map(x => x.textContent.trim()));
    checa('o seletor traz só Pré-análise e Repasse',
      JSON.stringify(ordem) === JSON.stringify(['Pré-análise', 'Repasse']), JSON.stringify(ordem));

    await p.click('#seletor-painel-botoes button[data-painel="PRE_ANALISE"]');
    await p.waitForSelector('#pn-kpis-pa', { timeout: 5000 });
    await p.waitForTimeout(400);
    const pa = await lerKpis(p, 'pn-kpis-pa');
    checa('sem a Venda, o cartão de conversão não é desenhado',
      pa.length === 8 && !pa.some(x => /Conversão/.test(x.rot)), JSON.stringify(pa.map(x => x.rot)));
    checa('e a tabela da Venda não é consultada',
      await p.evaluate(() => !performance.getEntriesByType('resource')
        .some(r => /a1_comerciais|a1_co_/.test(r.name))));
    checa('nenhum XSS', (await p.evaluate(() => window.__XSS || 0)) === 0);
    checa('sem erro de JS', erros.length === 0, erros[0] || '');
    todosErros.push(...erros);
    await b.close();
  }

  process.exit(resumo(todosErros) ? 1 : 0);
})();
