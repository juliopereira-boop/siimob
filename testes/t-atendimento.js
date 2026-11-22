// Central de atendimento (módulo ATENDIMENTO), dentro de Leads.
//
// O PEDIDO DO DONO
//   "os leads chegam pelas integrações de anúncios, caem no início do pipeline
//    e entram na central de atendimento (...) o agente entra em contato e
//    qualifica, depois envia o lead para fila de distribuição e distribui para
//    algum corretor (...) omnichannel, igual o chatwoot, com características
//    visuais do WhatsApp + SIIMOB"
//   "se não for atribuído a nenhum corretor, somente o gestor conversa"
//
// O QUE ESTE ARQUIVO PROVA
// 1. Sem a licença ATENDIMENTO a aba nem existe no funil de Leads, e a página
//    manda embora.
// 2. Com a licença: a aba aparece antes de Andamento; a fila mostra os leads,
//    com o canal, a prévia e o "Novo"; abrir mostra a conversa, as respostas
//    do formulário e o próximo da roleta.
// 3. Mensagem abre o WhatsApp com o texto e registra pela função do banco;
//    nota interna também, sem abrir nada.
// 4. Distribuir manda a versão lida; desqualificar exige motivo e manda o
//    motivo escolhido.
// 5. O corretor não tem a aba "Na fila" e não vê botão de distribuir.
// 6. Nome do lead é escapado (XSS).
const { abrir, checa, resumo } = require('./comum');

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';
const agora = Date.now();
const iso = (min = 0) => new Date(agora - min * 60000).toISOString();

function cenario() {
  return {
    conversas: [
      {
        id: 'at1',
        case_id: 'c1',
        canal: 'meta',
        status: 'aberta',
        pendente: true,
        corretor_nome: null,
        resultado: null,
        ultima_em: iso(1),
        ultima_previa: 'Novo lead · Meta · Campanha Nov',
        versao: 3,
        criado_em: iso(1)
      },
      {
        id: 'at2',
        case_id: 'c2',
        canal: 'whatsapp',
        status: 'distribuida',
        pendente: false,
        corretor_nome: 'Ana Corretora',
        resultado: 'qualificado',
        finalizado_por: 'Julio',
        finalizado_em: iso(30),
        ultima_em: iso(30),
        ultima_previa: 'Lead qualificado...',
        versao: 2,
        criado_em: iso(60)
      },
      {
        id: 'at3',
        case_id: 'c3',
        canal: 'instagram',
        status: 'encerrada',
        pendente: false,
        resultado: 'desqualificado',
        ultima_em: iso(120),
        ultima_previa: 'Lead desqualificado',
        versao: 2,
        criado_em: iso(200)
      }
    ],
    leads: [
      {
        id: 'c1',
        client_name: 'Maria da Meta ' + XSS,
        client_phone: '(98) 99999-0001',
        client_email: 'maria@x.com',
        partner_name: 'Meta · Campanha Nov',
        stage_name: 'Lead Recebido',
        payload: {
          integracao: {
            origem: 'meta',
            dados: {
              formulario_nome: 'Lançamento Jardins',
              campanha: 'Campanha Nov',
              respostas: [{ pergunta: 'qual sua renda?', resposta: 'R$ 5 mil' }]
            }
          }
        }
      },
      {
        id: 'c2',
        client_name: 'Pedro WhatsApp',
        client_phone: '98988887777',
        stage_name: 'Em atendimento',
        broker_name: 'Ana Corretora',
        payload: {}
      },
      { id: 'c3', client_name: 'Lia Insta', client_phone: null, stage_name: 'Perdido', payload: {} }
    ],
    msgs: {
      at1: [
        {
          id: 'm1',
          autor_tipo: 'sistema',
          autor_nome: 'SIIMOB',
          tipo: 'evento',
          corpo: 'Lead recebido pela Meta.\nRenda: R$ 5 mil',
          criado_em: iso(1)
        }
      ],
      at2: [],
      at3: []
    },
    proximo: 'Ana Corretora',
    rpc: []
  };
}

function rotas(est) {
  return (url, metodo, corpo) => {
    if (url.includes('/rest/v1/a1_atendimentos')) return est.conversas;
    if (url.includes('/rest/v1/a1_atendimento_mensagens')) {
      const id = (url.match(/atendimento_id=eq\.([a-z0-9-]+)/) || [])[1];
      return est.msgs[id] || [];
    }
    if (url.includes('/rest/v1/a1_cases') && url.includes('id=in.')) return est.leads;
    if (url.includes('/rpc/a1_roleta_proximo_nome')) return est.proximo;
    if (url.includes('/rpc/a1_atend_corretores')) return [{ id: 'p1', name: 'Ana Corretora' }];
    if (url.includes('/rpc/a1_atend_elia')) {
      const b = JSON.parse(corpo || '{}');
      const c = est.conversas.find(x => x.id === b.p_atendimento);
      if (c) {
        c.elia_ativa = b.p_ativa;
        c.versao++;
      }
      return null;
    }
    if (url.includes('/rpc/a1_atend_qualificacao_manual')) {
      const b = JSON.parse(corpo || '{}');
      est.rpc.push({ f: 'qualificacao', ...b });
      const c = est.conversas.find(x => x.id === b.p_atendimento);
      const lead = est.leads.find(x => x.id === c.case_id);
      lead.payload.qualificacao = b.p_dados;
      c.versao++;
      return null;
    }
    if (url.includes('crm_cad_motivos_perda'))
      return [{ value: JSON.stringify([{ name: 'Sem renda' }, { name: 'Inativo', active: false }]) }];
    if (url.includes('/rpc/a1_atend_enviar')) {
      const b = JSON.parse(corpo || '{}');
      est.rpc.push({ f: 'enviar', ...b });
      est.msgs[b.p_atendimento] = [
        ...(est.msgs[b.p_atendimento] || []),
        {
          id: 'n' + est.rpc.length,
          autor_tipo: 'atendente',
          autor_nome: 'Julio',
          tipo: b.p_tipo,
          corpo: b.p_corpo,
          criado_em: new Date().toISOString()
        }
      ];
      return { ok: true };
    }
    if (url.includes('/rpc/a1_atend_finalizar')) {
      const b = JSON.parse(corpo || '{}');
      est.rpc.push({ f: 'finalizar', ...b });
      return { ok: true, corretor: 'Ana Corretora', etapa: 'Em atendimento' };
    }
    return undefined;
  };
}

(async () => {
  const todos = [];

  console.log('== Sem a licença ==');
  {
    const { b, p, erros } = await abrir('thecred/crm', { modulos: ['crm'] });
    const subs = await p.$$eval('.sb-sub-item', l => l.map(x => x.textContent.trim()));
    checa(
      'a aba Central de atendimento nem existe no funil',
      !subs.some(s => /Central/.test(s)),
      subs.join('|')
    );
    await b.close();
    todos.push(...erros);
  }
  {
    const { b, p } = await abrir('thecred/atendimento', { modulos: ['crm'] });
    checa(
      'e a página da Central manda embora',
      !/\/atendimento/.test(p.url()) || !(await p.$('#at-itens .at-item')),
      p.url()
    );
    await b.close();
  }

  console.log('\n== Gestor com a licença ==');
  {
    const { b, p, erros } = await abrir('thecred/crm', { modulos: ['crm', 'ATENDIMENTO'] });
    const subs = await p.$$eval('.sb-sub-item', l => l.map(x => x.textContent.trim()));
    checa(
      'no funil, a Central aparece antes de Andamento',
      subs[0] === 'Central de atendimento' && subs[1] === 'Andamento',
      subs.join('|')
    );
    await b.close();
    todos.push(...erros);
  }
  {
    const est = cenario();
    const { b, p, erros } = await abrir('thecred/atendimento', {
      modulos: ['crm', 'ATENDIMENTO'],
      antes: rotas(est)
    });
    await p.waitForTimeout(400);
    const abas = await p.$$eval('#at-abas .at-aba', l =>
      l.map(x => x.textContent.replace(/\s+/g, ' ').trim())
    );
    checa(
      'abas com contagem: Na fila 1, Com corretor 1, Encerradas 1',
      abas.join('|') === 'Na fila1|Com corretor1|Encerradas1|Todas3',
      abas.join('|')
    );
    const itens = await p.$$eval('#at-itens .at-item', l => l.map(x => x.dataset.id));
    checa('o gestor abre na fila, só com o lead sem corretor', itens.join(',') === 'at1', itens.join(','));
    checa(
      'o item mostra o canal Meta, a prévia e o "Novo"',
      !!(await p.$('.at-item[data-id="at1"] .canal-meta')) &&
        /Campanha Nov/.test(await p.textContent('.at-item[data-id="at1"]')) &&
        !!(await p.$('.at-item[data-id="at1"] .at-novo'))
    );
    checa(
      'a modalidade ELIA pode ser selecionada como filtro',
      await p.$eval('#at-elia', e => !e.disabled && e.dataset.modo === 'elia')
    );

    await p.click('.at-item[data-id="at1"]');
    await p.waitForTimeout(400);
    checa(
      'abrir mostra a mensagem do sistema com as respostas',
      /Renda: R\$ 5 mil/.test(await p.textContent('#at-msgs'))
    );
    const lead = await p.textContent('#at-lead');
    checa(
      'o painel mostra formulário, campanha e respostas',
      /Lançamento Jardins/.test(lead) && /qual sua renda\?/.test(lead) && /R\$ 5 mil/.test(lead)
    );
    checa('e o próximo da roleta', /Próximo da vez:\s*Ana Corretora/.test(lead), lead.slice(0, 200));
    checa(
      'o aviso explica que o WhatsApp ainda não está integrado',
      /ainda não integrado/.test(await p.textContent('#at-compor-aviso'))
    );

    console.log('\n-- Mensagem e nota --');
    await p.evaluate(() => {
      window.__abriu = [];
      window.open = u => (window.__abriu.push(String(u)), null);
    });
    await p.fill('#at-texto', 'Olá Maria, tudo bem?');
    await p.press('#at-texto', 'Enter');
    await p.waitForTimeout(400);
    const abriu = await p.evaluate(() => window.__abriu);
    checa(
      'Enter manda: abre o WhatsApp do lead com o texto',
      abriu.length === 1 &&
        abriu[0].startsWith('https://wa.me/5598999990001?text=') &&
        abriu[0].includes(encodeURIComponent('Olá Maria')),
      abriu.join(' ')
    );
    const env = est.rpc.find(r => r.f === 'enviar') || {};
    checa(
      'e registra pela função do banco',
      env.p_atendimento === 'at1' && env.p_tipo === 'mensagem' && env.p_corpo === 'Olá Maria, tudo bem?',
      JSON.stringify(env)
    );
    checa(
      'a mensagem aparece como balão enviado',
      !!(await p.$('#at-msgs .at-sai')) && /Olá Maria/.test(await p.textContent('#at-msgs .at-sai'))
    );
    checa('a caixa limpa', (await p.inputValue('#at-texto')) === '');
    await p.click('.at-compor-tipo button[data-tipo="nota"]');
    await p.fill('#at-texto', 'Ligar de novo às 15h');
    await p.click('#at-enviar');
    await p.waitForTimeout(400);
    checa('nota interna não abre o WhatsApp', (await p.evaluate(() => window.__abriu.length)) === 1);
    checa('e vai como nota', (est.rpc.filter(r => r.f === 'enviar')[1] || {}).p_tipo === 'nota');
    checa(
      'aparece com o rótulo de nota interna',
      /Nota interna/.test(await p.textContent('#at-msgs .at-nota'))
    );

    console.log('\n-- Desqualificar e distribuir --');
    await p.click('[data-acao="atDesqualificar"]');
    const opcoes = await p.$$eval('#at-motivo option', l => l.map(o => o.textContent));
    checa(
      'o motivo vem do catálogo, sem os inativos',
      opcoes.join('|') === 'Escolha…|Sem renda',
      opcoes.join('|')
    );
    await p.click('[data-acao="atConfirmarDesq"]');
    await p.waitForTimeout(200);
    checa(
      'sem motivo não desqualifica',
      !est.rpc.some(r => r.f === 'finalizar') && /motivo/.test(await p.textContent('#at-toasts'))
    );
    await p.selectOption('#at-motivo', 'Sem renda');
    await p.click('[data-acao="atConfirmarDesq"]');
    await p.waitForTimeout(400);
    const desq = est.rpc.find(r => r.f === 'finalizar') || {};
    checa(
      'desqualificar manda o motivo e a versão lida',
      desq.p_resultado === 'desqualificado' && desq.p_motivo === 'Sem renda' && desq.p_versao === 3,
      JSON.stringify(desq)
    );

    await p.click('[data-acao="atDistribuir"]');
    await p.waitForTimeout(400);
    await p.selectOption('#at-escolher-corretor', 'roleta');
    await p.click('#at-vincular [value="vincular"]');
    await p.waitForTimeout(400);
    const dist = est.rpc.filter(r => r.f === 'finalizar')[1] || {};
    checa(
      'distribuir chama a roleta com a versão lida',
      dist.p_resultado === 'qualificado' && dist.p_atendimento === 'at1' && dist.p_versao === 3,
      JSON.stringify(dist)
    );
    checa('e avisa para quem foi', /vinculado a Ana Corretora/.test(await p.textContent('#at-toasts')));

    console.log('\n-- Ao vivo --');
    est.conversas = [
      {
        id: 'at9',
        case_id: 'c9',
        canal: 'meta',
        status: 'aberta',
        pendente: true,
        ultima_em: new Date().toISOString(),
        ultima_previa: 'Novo lead',
        versao: 1
      },
      ...est.conversas
    ];
    est.leads = [...est.leads, { id: 'c9', client_name: 'Carlos Novo', payload: {} }];
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await p.waitForTimeout(600);
    checa('lead novo entra na fila sozinho', !!(await p.$('.at-item[data-id="at9"]')));
    checa('com aviso', /Novo lead na fila: Carlos Novo/.test(await p.textContent('#at-toasts')));
    console.log('\n-- Tela estreita --');
    await p.setViewportSize({ width: 900, height: 800 });
    await p.click('.at-item[data-id="at1"]');
    await p.waitForTimeout(300);
    checa('em tela estreita, o painel do lead fica escondido', !(await p.isVisible('#at-lead')));
    await p.click('[data-acao="atPainel"]');
    checa(
      'o botão de dados abre o painel com a qualificação',
      (await p.isVisible('#at-lead')) && (await p.isVisible('[data-acao="atDistribuir"]'))
    );
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Corretor ==');
  {
    const est = cenario();
    est.conversas = est.conversas.filter(c => c.status !== 'aberta');
    const { b, p, erros } = await abrir('thecred/atendimento', {
      modulos: ['crm', 'ATENDIMENTO'],
      antes: rotas(est),
      usuario: {
        id: 'p1',
        partner_id: 'p1',
        tenant_id: 't1',
        name: 'Ana Corretora',
        role: 'partner',
        type: 'corretor'
      }
    });
    await p.waitForTimeout(400);
    const abas = await p.$$eval('#at-abas .at-aba', l =>
      l.map(x => x.textContent.replace(/\d+/g, '').trim())
    );
    checa(
      'o corretor não tem a aba "Na fila"',
      !abas.includes('Na fila') && abas[0] === 'Com corretor',
      abas.join('|')
    );
    await p.click('.at-item[data-id="at2"]');
    await p.waitForTimeout(400);
    checa(
      'na conversa dele, não há botão de distribuir visível',
      (await p.locator('[data-acao="atDistribuir"]:visible').count()) === 0
    );
    checa('e ele pode escrever', !(await p.$eval('#at-texto', e => e.disabled)));
    checa(
      'o resultado mostra para quem foi',
      /distribuído para\s*Ana Corretora/.test(await p.textContent('#at-lead'))
    );
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Configurações › Roleta de distribuição ==');
  {
    const { b, p, erros } = await abrir('thecred/configuracoes', { modulos: ['crm'] });
    checa('sem a licença, o cartão da roleta nem existe', !(await p.$('#cfg-card-roleta')));
    await b.close();
    todos.push(...erros);
  }
  {
    const salvo = [];
    const corretores = [
      { id: 'p1', name: 'Ana Corretora', is_active: true, approved: true },
      { id: 'p2', name: 'Bruno ' + XSS, is_active: true, approved: true },
      { id: 'p3', name: 'Gil Desligado', is_active: false, approved: true }
    ];
    const { b, p, erros } = await abrir('thecred/configuracoes', {
      modulos: ['crm', 'ATENDIMENTO'],
      antes: (url, metodo, corpo) => {
        if (url.includes('/rest/v1/a1_partners') && url.includes('select=id,name,is_active,approved'))
          return corretores;
        if (url.includes('/rest/v1/a1_lead_roleta')) return [{ participantes: ['p2'] }];
        if (url.includes('/rpc/a1_roleta_proximo_nome')) return 'Bruno ' + XSS;
        if (url.includes('/rpc/a1_roleta_salvar')) {
          salvo.push(JSON.parse(corpo || '{}'));
          return { ok: true };
        }
        return undefined;
      }
    });
    await p.waitForTimeout(500);
    checa('com a licença, o cartão aparece em Leads', !!(await p.$('#cfg-cards-leads #cfg-card-roleta')));
    await p.click('#cfg-card-roleta');
    await p.waitForTimeout(500);
    const naRoleta = await p.$$eval('#roleta-corpo ol .roleta-item label', l =>
      l.map(x => x.textContent.trim())
    );
    checa(
      'mostra quem está na roleta, em ordem',
      naRoleta.length === 1 && /^Bruno/.test(naRoleta[0]),
      naRoleta.join('|')
    );
    checa('marca o próximo da vez', /próximo da vez/.test(await p.textContent('#roleta-corpo ol')));
    checa('o desligado aparece avisado', /desligado/.test(await p.textContent('#roleta-corpo')));
    await p.check('#roleta-corpo input[data-id="p1"]');
    await p.waitForTimeout(150);
    await p.click('#roleta-corpo [data-acao="roletaSubir"][data-id="p1"]');
    await p.waitForTimeout(150);
    await p.click('[data-acao="roletaSalvar"]');
    await p.waitForTimeout(400);
    checa(
      'salvar manda os participantes na ordem escolhida',
      JSON.stringify(salvo[0]) === JSON.stringify({ p_participantes: ['p1', 'p2'] }),
      JSON.stringify(salvo)
    );
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== ELIA, humano e qualificação ==');
  {
    const est = cenario();
    est.conversas[0].elia_ativa = true;
    est.leads[0].payload.qualificacao = { renda: '2500', empreendimento: 'Jardins' };
    const { b, p, erros } = await abrir('thecred/atendimento', {
      modulos: ['crm', 'ATENDIMENTO'],
      antes: rotas(est)
    });
    await p.waitForTimeout(400);
    checa('conversa da ELIA não aparece na fila humana', !(await p.$('.at-item[data-id="at1"]')));
    await p.click('#at-elia');
    checa('a aba ELIA lista a conversa ativa', !!(await p.$('.at-item[data-id="at1"]')));
    await p.click('.at-item[data-id="at1"]');
    checa(
      'qualificação da ELIA aparece protegida contra edição humana',
      (await p.locator('[data-qual="renda"]').inputValue()) === '2500' &&
        (await p.locator('[data-qual="renda"]').isDisabled())
    );
    await p.click('#at-chat-elia');
    await p.waitForTimeout(300);
    checa(
      'ao retomar, muda para a aba Humano',
      (await p.getAttribute('#at-humano', 'aria-pressed')) === 'true'
    );
    await p.locator('[data-qual="renda"]').fill('3000');
    await p.click('[data-acao="atQualSalvar"]');
    await p.waitForTimeout(300);
    checa(
      'salvamento manual usa a conversa e os dados escolhidos',
      est.rpc.some(x => x.f === 'qualificacao' && x.p_atendimento === 'at1' && x.p_dados.renda === '3000')
    );
    checa('sem erro de JS na qualificação', erros.length === 0, erros[0] || '');
    await b.close();
    todos.push(...erros);
  }
  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
