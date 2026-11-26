// WhatsApp oficial (API da Meta pela Coexy) com a Evolution de reserva.
//
// O PEDIDO DO DONO
//   "quero manter com a evoluition, porem quero que o principal seja com a
//    meta ... toda a conexao que existe hoje do whatsapp, quero que seja via
//    whatsaap oficial, central de atendimento, integraçoes, e claro, é pra ter
//    atendimento virtual sim"
//
// O que este arquivo prova:
//   - Integrações: o cartão do oficial vem antes do QR Code; sem a chave da
//     Coexy no servidor, avisa; conectar abre a página de conexão e mostra o
//     link; conectado mostra número, saúde (com o motivo da Meta), reserva,
//     criar leads e os modelos; criar modelo confere as variáveis antes;
//   - Central: com o oficial, mostra a janela de 24 h; fora dela oferece o
//     modelo aprovado (com o primeiro nome do lead), manda pela função e avisa
//     quando saiu pela reserva; as mensagens mostram a entrega e a reserva;
//   - ELIA: campanha com modelo aprovado manda o modelo e as variáveis;
//   - nada vira HTML (XSS).
const { abrir, checa, resumo } = require('./comum');

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';
const LINK = 'https://coexy.com.br/connect/abc123';
const MODELOS = [
  {
    nome: 'boas_vindas',
    idioma: 'pt_BR',
    categoria: 'MARKETING',
    status: 'APPROVED',
    corpo: 'Oi {{1}}, temos novidades ' + XSS,
    cabecalho: null,
    rodape: 'SIIMOB',
    variaveis: 1,
    suportado: true
  },
  {
    nome: 'lembrete_visita',
    idioma: 'pt_BR',
    categoria: 'UTILITY',
    status: 'PENDING',
    corpo: 'Sua visita é {{1}} às {{2}}.',
    variaveis: 2,
    suportado: true
  }
];

function servidor(est) {
  return (url, metodo, corpo) => {
    if (/functions\/v1\/atendimento-conectores/.test(url) && metodo === 'POST') {
      const d = JSON.parse(corpo || '{}');
      est.chamadas.push(d);
      if (d.action === 'status') return { ia: est.ia, whatsapp: est.wa, oficial: est.oficial };
      if (d.action === 'oficial_conectar') {
        est.oficial = { ...est.oficial, estado: 'pending', connect_url: LINK };
        return { ok: true, oficial: est.oficial };
      }
      if (d.action === 'oficial_opcoes') {
        est.oficial = { ...est.oficial, ...d };
        return { ok: true, oficial: est.oficial };
      }
      if (d.action === 'wa_modelos') return { ok: true, modelos: est.modelos || MODELOS };
      if (d.action === 'modelo_criar') return { ok: true, status: 'PENDING' };
      if (d.action === 'wa_modelo' || d.action === 'wa_enviar') return est.envio(d);
      return { __status: 400, corpo: { error: 'invalid_request' } };
    }
    if (url.includes('/rpc/a1_wa_ligado')) return est.ligado || { ligado: false };
    return undefined;
  };
}

const IA = {
  configurada: true,
  propria: false,
  plataforma_disponivel: true,
  final: null,
  modelo: 'gpt-4.1-mini',
  teste_ok: true
};

(async () => {
  const todos = [];

  console.log('== Integrações: oficial sem a chave da Coexy no servidor ==');
  {
    const est = {
      chamadas: [],
      ia: IA,
      wa: { servidor_configurado: true, estado: 'nao_criado' },
      oficial: { configurado: false, estado: 'nao_criado' }
    };
    const { b, p, erros } = await abrir('thecred/configuracoes#integracoes', {
      antes: servidor(est),
      modulos: ['crm', 'ATENDIMENTO']
    });
    await p.waitForSelector('#wo-card');
    await p.waitForTimeout(400);
    checa(
      'o cartão do oficial vem antes do QR Code',
      await p.evaluate(
        () =>
          !!(
            document.getElementById('wo-card').compareDocumentPosition(document.getElementById('wa-card')) &
            Node.DOCUMENT_POSITION_FOLLOWING
          )
      )
    );
    checa(
      'sem a chave, avisa "Aguardando servidor"',
      /Aguardando servidor/.test(await p.textContent('#wo-selo'))
    );
    checa('e não mostra conectar', await p.isHidden('#wo-conectar'));
    checa('o QR Code vira reserva', /Reserva/.test(await p.textContent('#wa-card .mi-nome small')));
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Integrações: conectar e conectado ==');
  {
    const est = {
      chamadas: [],
      ia: IA,
      wa: { servidor_configurado: true, estado: 'nao_criado' },
      oficial: { configurado: true, estado: 'nao_criado' }
    };
    const { b, p, erros } = await abrir('thecred/configuracoes#integracoes', {
      antes: servidor(est),
      modulos: ['crm', 'ATENDIMENTO']
    });
    await p.waitForSelector('#wo-card');
    await p.waitForTimeout(400);
    await p.evaluate(() => {
      window.__abertas = [];
      window.open = u => {
        const j = { location: { href: u }, close() {}, opener: 1 };
        window.__abertas.push(j);
        return j;
      };
    });
    checa('sem conexão, mostra "Conectar WhatsApp oficial"', await p.isVisible('#wo-conectar'));
    await p.click('#wo-conectar');
    await p.waitForTimeout(500);
    checa(
      'conectar chama a função',
      est.chamadas.some(c => c.action === 'oficial_conectar')
    );
    checa(
      'a página de conexão abre em outra aba',
      (await p.evaluate(() => window.__abertas[0] && window.__abertas[0].location.href)) === LINK
    );
    checa(
      'o link aparece para mandar a quem cuida do número',
      (await p.getAttribute('#wo-painel a', 'href')) === LINK
    );
    checa('selo "Aguardando conexão"', /Aguardando conexão/.test(await p.textContent('#wo-selo')));
    checa(
      'nenhum token na página',
      !(await p.evaluate(() => /tok_|channel_token/.test(document.body.innerHTML)))
    );
    // a pessoa concluiu na Meta: a próxima conferência já vem ativa
    est.oficial = {
      configurado: true,
      estado: 'active',
      numero: '559884466040',
      saude: 'blocked',
      saude_motivo: 'Pagamento recusado na Meta ' + XSS,
      limite: 'TIER_250',
      reserva_auto: true,
      criar_leads: true,
      modelos: true,
      connect_url: null
    };
    await p.click('#wo-conferir');
    await p.waitForTimeout(600);
    checa('selo mostra o bloqueio da Meta', /Bloqueado/.test(await p.textContent('#wo-selo')));
    const painel = await p.textContent('#wo-painel');
    checa('mostra o motivo da Meta (como texto)', /Pagamento recusado na Meta <img/.test(painel));
    checa('mostra o número e o limite', /\+55 \(98\) 8446-6040/.test(painel) && /250/.test(painel), painel);
    checa('os modelos aparecem com o status', /boas_vindas/.test(painel) && /Em análise/.test(painel));
    await p.click('#wo-reserva');
    await p.waitForTimeout(300);
    checa(
      'desligar a reserva vai para o servidor',
      est.chamadas.some(c => c.action === 'oficial_opcoes' && c.reserva_auto === false)
    );
    await p.click('[data-acao="woModeloNovo"]');
    await p.fill('#wo-m-nome', 'novidade_semana');
    await p.fill('#wo-m-corpo', 'Oi {{1}}, temos {{2}}.');
    await p.fill('#wo-m-ex', 'Ana');
    await p.click('[data-acao="woModeloCriar"]');
    await p.waitForTimeout(300);
    checa(
      'faltando exemplo, avisa e não manda',
      /2 exemplo/.test(await p.textContent('#wo-aviso')) &&
        !est.chamadas.some(c => c.action === 'modelo_criar')
    );
    await p.fill('#wo-m-ex', 'Ana; casas novas');
    await p.click('[data-acao="woModeloCriar"]');
    await p.waitForTimeout(400);
    const criar = est.chamadas.find(c => c.action === 'modelo_criar');
    checa(
      'cria o modelo com nome, categoria e um exemplo por variável',
      criar &&
        criar.nome === 'novidade_semana' &&
        criar.categoria === 'MARKETING' &&
        criar.exemplos.join('|') === 'Ana|casas novas'
    );
    checa('avisa que foi para a revisão da Meta', /revisão da Meta/.test(await p.textContent('#wo-aviso')));
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Central: janela de 24 h, modelo, entrega e reserva ==');
  {
    const agora = Date.now();
    const est = {
      chamadas: [],
      ligado: { ligado: true, canal: 'oficial', oficial: true, reserva: true },
      envio: d => ({
        ok: true,
        id: 'm9',
        tipo: 'iniciado',
        canal: 'evolution',
        reserva: true,
        alerta: false,
        _d: d
      })
    };
    let msgs = [
      {
        id: 'm1',
        autor_tipo: 'lead',
        autor_nome: 'Joana',
        tipo: 'mensagem',
        corpo: 'Oi',
        criado_em: new Date(agora - 3600000).toISOString(),
        externo: 'wamid.1'
      },
      {
        id: 'm2',
        autor_tipo: 'atendente',
        autor_nome: 'Gestor',
        tipo: 'mensagem',
        corpo: 'Olá Joana',
        criado_em: new Date(agora - 3000000).toISOString(),
        externo: 'wamid.2',
        canal: 'oficial',
        entrega: 'lida'
      },
      {
        id: 'm3',
        autor_tipo: 'ia',
        autor_nome: 'ELIA',
        tipo: 'mensagem',
        corpo: 'Posso ajudar?',
        criado_em: new Date(agora - 2000000).toISOString(),
        externo: 'BAE5',
        canal: 'evolution',
        entrega: null
      },
      {
        id: 'm4',
        autor_tipo: 'atendente',
        autor_nome: 'Gestor',
        tipo: 'mensagem',
        corpo: 'Não chegou',
        criado_em: new Date(agora - 1000000).toISOString(),
        externo: 'wamid.4',
        canal: 'oficial',
        entrega: 'falhou'
      }
    ];
    const rotas = servidor(est);
    const conversa = {
      id: 'at1',
      case_id: 'c1',
      canal: 'whatsapp',
      status: 'aberta',
      pendente: true,
      ultima_em: new Date(agora).toISOString(),
      ultima_previa: 'Oi',
      versao: 1
    };
    const { b, p, erros } = await abrir('thecred/atendimento', {
      modulos: ['crm', 'ATENDIMENTO'],
      antes: (url, metodo, corpo) => {
        if (url.includes('/rest/v1/a1_atendimentos')) return [conversa];
        if (url.includes('/rest/v1/a1_atendimento_mensagens')) return msgs;
        if (url.includes('/rest/v1/a1_cases') && url.includes('id=in.'))
          return [
            {
              id: 'c1',
              client_name: 'Joana Silva',
              client_phone: '(98) 98123-4567',
              payload: { integracao: { origem: 'whatsapp' } }
            }
          ];
        if (url.includes('/rpc/a1_roleta_proximo_nome')) return null;
        return rotas(url, metodo, corpo);
      }
    });
    await p.click('.at-item[data-id="at1"]');
    await p.waitForTimeout(500);
    checa(
      'com o lead escrevendo há 1 h: janela aberta',
      /janela de 24 h aberta até/.test(await p.textContent('#at-compor-aviso'))
    );
    checa('mensagem lida: marca azul', !!(await p.$('.at-sai .at-vistos[aria-label="Lida"]')));
    checa('mensagem que falhou: marca de erro', !!(await p.$('.at-sai .at-vistos.at-falhou')));
    checa('mensagem que saiu pela reserva: marcada', /reserva/.test(await p.textContent('#at-msgs')));
    checa('o botão de modelo está à mão', await p.isVisible('#at-chat-modelo'));

    // a conversa esfria: o lead escreveu há 2 dias
    msgs = msgs.map(m => ({ ...m, criado_em: new Date(agora - 2 * 86400000).toISOString() }));
    await p.click('.at-item[data-id="at1"]');
    await p.waitForTimeout(9000); // o ao vivo relê a conversa
    checa(
      'fora da janela: pede modelo e diz que o texto vai pela reserva',
      /Fora da janela de 24 h/.test(await p.textContent('#at-compor-aviso')) &&
        /reserva/.test(await p.textContent('#at-compor-aviso')),
      await p.textContent('#at-compor-aviso')
    );
    await p.click('#at-chat-modelo');
    await p.waitForTimeout(500);
    const opcoes = await p.$$eval('#at-modelo-escolha option', l => l.map(o => o.textContent));
    checa('só modelos aprovados', opcoes.length === 1 && /boas_vindas/.test(opcoes[0]), opcoes.join(','));
    checa('a variável já vem com o primeiro nome', (await p.inputValue('#at-modelo-vars input')) === 'Joana');
    checa(
      'a prévia mostra o texto (sem virar HTML)',
      /Oi Joana, temos novidades <img/.test(await p.textContent('#at-modelo-previa'))
    );
    await p.fill('#at-modelo-vars input', 'Jô');
    await p.click('#at-modelo [value="enviar"]');
    await p.waitForTimeout(600);
    const env = est.chamadas.find(c => c.action === 'wa_modelo');
    checa(
      'manda o modelo, o idioma e as variáveis para a função',
      env &&
        env.atendimento_id === 'at1' &&
        env.modelo.nome === 'boas_vindas' &&
        env.modelo.idioma === 'pt_BR' &&
        env.parametros.join() === 'Jô'
    );
    checa('o diálogo fecha', !(await p.evaluate(() => document.getElementById('at-modelo').open)));
    checa('avisa que saiu pela reserva', /reserva/.test(await p.textContent('#at-toasts')));
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== ELIA: campanha com modelo aprovado ==');
  {
    const est = { chamadas: [] };
    const conectores = servidor(est);
    const { b, p, erros } = await abrir('thecred/configuracoes/elia', {
      modulos: ['crm', 'ATENDIMENTO'],
      antes: (url, metodo, corpo) => {
        if (/functions\/v1\/elia/.test(url) && metodo === 'POST') {
          const d = JSON.parse(corpo || '{}');
          est.chamadas.push(d);
          if (d.action === 'load')
            return {
              profile: { nome: 'ELIA', empreendimentos: [] },
              flow: [],
              enabled: false,
              google: false,
              googleReady: false,
              campaigns: [],
              jobs: [],
              stages: [],
              partners: []
            };
          if (d.action === 'contacts')
            return {
              contacts: [{ id: 'c1', client_name: 'Joana', client_phone: '(98) 98123-4567', consent: true }]
            };
          if (d.action === 'campaign') return { ok: true };
          return { ok: true };
        }
        return conectores(url, metodo, corpo);
      }
    });
    await p.waitForSelector('nav [data-acao="eliaAba"]');
    await p.click('nav [data-key="campanhas"]');
    await p.waitForSelector('[data-modelo-campanha]');
    const opts = await p.$$eval('[data-modelo-campanha] option', l => l.map(o => o.textContent));
    checa(
      'o seletor traz só os modelos aprovados',
      opts.length === 2 && /boas_vindas/.test(opts[1]),
      opts.join(',')
    );
    await p.selectOption('[data-modelo-campanha]', '0');
    await p.waitForTimeout(200);
    checa('com modelo, o anexo some (a Meta não aceita aqui)', !(await p.$('[data-upload="campaign"]')));
    await p.fill('[data-modelo-param="0"]', '{{nome}}');
    await p.click('[data-acao="eliaBuscarContatos"]');
    await p.waitForTimeout(300);
    await p.check('[data-recipient="c1"]');
    await p.fill('[data-draft="title"]', 'Feirão');
    await p.evaluate(() => {
      window.confirm = () => true;
    });
    await p.click('[data-acao="eliaEnfileirar"]');
    await p.waitForTimeout(400);
    const camp = est.chamadas.find(c => c.action === 'campaign');
    checa(
      'a campanha leva o modelo e a variável com {{nome}}',
      camp &&
        camp.modelo &&
        camp.modelo.nome === 'boas_vindas' &&
        camp.modelo.parametros.join() === '{{nome}}' &&
        camp.file === null
    );
    checa(
      'o texto da reserva sai do modelo quando fica em branco',
      camp && /^Oi \{\{nome\}\}, temos novidades/.test(camp.message)
    );
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
    await b.close();
    todos.push(...erros);
  }

  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
