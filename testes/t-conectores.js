// Configurações › Integrações: OpenAI e WhatsApp (pacote da Central) e o envio
// pelo WhatsApp na Central de atendimento.
//
// O PEDIDO DO DONO
//   "ja crie o ambiente, para integrar com a llm, por enquanto usarei da
//    openai, coloque dentro da configuraçao de integracoes, ao lado da meta."
//   "eu vou integrar o evolution (...) se voce verificar que esta chegando no
//    limite, pause, mostre um aviso, e continue quando der"
//
// O que este arquivo prova:
//   - sem a licença ATENDIMENTO, os cartões nem existem no DOM;
//   - com a licença, a chave da OpenAI vai para o servidor e volta só o final;
//   - conectar o WhatsApp mostra o QR (só PNG em data:), e conectado mostra o
//     número, o aquecimento, o uso e a pausa;
//   - na Central, com o WhatsApp ligado, a mensagem sai pela função (sem abrir
//     o wa.me); no limite, a tela avisa e diz quando volta;
//   - nada vira HTML (XSS).
const { abrir, checa, resumo } = require('./comum');

const XSS = '<img src=x onerror="window.__XSS=(window.__XSS||0)+1">';
const QR = 'data:image/png;base64,' + 'iVBORw0KGgo'.repeat(20);

function servidor(est) {
  return (url, metodo, corpo) => {
    if (/functions\/v1\/atendimento-conectores/.test(url) && metodo === 'POST') {
      const d = JSON.parse(corpo || '{}');
      est.chamadas.push(d);
      if (d.action === 'status') return { ia: est.ia, whatsapp: est.wa };
      if (d.action === 'ia_salvar') {
        est.ia = {
          ...est.ia,
          configurada: true,
          propria: true,
          final: d.chave ? d.chave.slice(-4) : est.ia.final,
          modelo: d.modelo || est.ia.modelo,
          teste_ok: true
        };
        return { ok: true, ia: est.ia };
      }
      if (d.action === 'ia_testar')
        return { ok: true, modelos: ['gpt-4.1-mini', 'gpt-4o-mini'], sugerido: 'gpt-4.1-mini', ia: est.ia };
      if (d.action === 'wa_conectar') {
        est.wa = { ...est.wa, estado: 'aguardando_qr' };
        return { ok: true, qr: QR, codigo: 'ABCD-1234', whatsapp: est.wa };
      }
      if (d.action === 'wa_opcoes') {
        est.wa = { ...est.wa, criar_leads: d.criar_leads };
        return { ok: true, whatsapp: est.wa };
      }
      if (d.action === 'wa_enviar') return est.envio(d);
      return { __status: 400, corpo: { error: 'invalid_request' } };
    }
    if (url.includes('/rpc/a1_wa_ligado')) return est.ligado || { ligado: false };
    return undefined;
  };
}

(async () => {
  const todos = [];

  console.log('== Sem a licença ATENDIMENTO ==');
  {
    const est = { chamadas: [] };
    const { b, p, erros } = await abrir('thecred/configuracoes#integracoes', {
      antes: servidor(est),
      modulos: ['crm']
    });
    checa('o cartão da Meta continua', !!(await p.$('#meta-card')));
    checa('OpenAI e WhatsApp não existem no DOM', !(await p.$('#ia-card')) && !(await p.$('#wa-card')));
    checa('e nada foi pedido à função dos conectores', est.chamadas.length === 0);
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Com a licença: OpenAI ==');
  {
    const est = {
      chamadas: [],
      ia: {
        configurada: false,
        propria: false,
        plataforma_disponivel: false,
        final: null,
        modelo: 'gpt-4.1-mini',
        teste_ok: null
      },
      wa: { servidor_configurado: false, estado: 'nao_criado' }
    };
    const { b, p, erros } = await abrir('thecred/configuracoes#integracoes', {
      antes: servidor(est),
      modulos: ['crm', 'ATENDIMENTO']
    });
    await p.waitForSelector('#ia-card');
    await p.waitForTimeout(400);
    checa(
      'OpenAI aparece ao lado da Meta, como "Não configurada"',
      /Não configurada/.test(await p.textContent('#ia-selo'))
    );
    checa('o campo da chave é de senha', (await p.getAttribute('#ia-chave', 'type')) === 'password');
    await p.fill('#ia-chave', 'sk-proj-abcdefghijklmnopqrstuvwxyz9876');
    await p.click('#ia-salvar');
    await p.waitForTimeout(400);
    const salvar = est.chamadas.find(c => c.action === 'ia_salvar');
    checa(
      'a chave vai para o servidor',
      !!salvar && salvar.chave === 'sk-proj-abcdefghijklmnopqrstuvwxyz9876'
    );
    checa('o campo é limpo depois de salvar', (await p.inputValue('#ia-chave')) === '');
    checa('volta só o final da chave', /terminada em 9876/.test(await p.textContent('#ia-resumo')));
    checa('selo vira "Conectada"', /Conectada/.test(await p.textContent('#ia-selo')));
    checa(
      'a chave inteira não fica em lugar nenhum da página',
      !(await p.evaluate(() => document.documentElement.outerHTML.includes('abcdefghijklmnopqrstuvwxyz')))
    );
    await p.click('#ia-testar');
    await p.waitForTimeout(400);
    const opcoes = await p.$$eval('#ia-modelo option', l => l.map(o => o.value));
    checa('testar traz os modelos da conta', opcoes.includes('gpt-4o-mini'), opcoes.join(','));
    checa(
      'WhatsApp sem servidor: avisa e não mostra conectar',
      /Aguardando servidor/.test(await p.textContent('#wa-selo')) && (await p.isHidden('#wa-conectar'))
    );
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Com a licença: WhatsApp ==');
  {
    const est = {
      chamadas: [],
      ia: {
        configurada: true,
        propria: false,
        plataforma_disponivel: true,
        final: null,
        modelo: 'gpt-4.1-mini',
        teste_ok: true
      },
      wa: { servidor_configurado: true, estado: 'nao_criado' }
    };
    const { b, p, erros } = await abrir('thecred/configuracoes#integracoes', {
      antes: servidor(est),
      modulos: ['crm', 'ATENDIMENTO']
    });
    await p.waitForSelector('#wa-card');
    await p.waitForTimeout(400);
    checa('sem conexão, mostra "Conectar WhatsApp"', await p.isVisible('#wa-conectar'));
    await p.click('#wa-conectar');
    await p.waitForTimeout(400);
    checa('aparece o QR Code', (await p.getAttribute('#wa-qr img', 'src')) === QR);
    checa('e o código de pareamento', /ABCD-1234/.test(await p.textContent('#wa-qr')));
    checa('selo "Aguardando QR"', /Aguardando QR/.test(await p.textContent('#wa-selo')));
    // o celular leu o QR: a próxima conferência já vem conectada, perto do limite e pausada
    est.wa = {
      servidor_configurado: true,
      estado: 'conectado',
      numero: '5598900001111',
      perfil_nome: 'Imob ' + XSS,
      criar_leads: true,
      pausado_ate: '2026-11-22T13:30:00Z',
      pausa_motivo: 'Limite de mensagens da hora atingido.',
      aquecimento: { dias: 2, rotulo: 'Número novo (dias 1 a 3)', por_dia: 20, por_hora: 8 },
      uso: { hoje: 30, hora: 12, frio_hoje: 17, frio_hora: 5, falhas_hora: 0, teto_dia: 800, teto_hora: 150 },
      disparo: { pode: true, motivo: null, volta_em: null },
      resposta: { pode: true, volta_em: null },
      alerta: true
    };
    await p.waitForTimeout(4600);
    checa(
      'conectou sozinho (confere a cada 4 s)',
      /Pausado/.test(await p.textContent('#wa-selo')),
      await p.textContent('#wa-selo')
    );
    checa('o QR some', await p.isHidden('#wa-qr'));
    const painel = await p.textContent('#wa-painel');
    checa('mostra o número', /\+55 \(98\) 90000-1111/.test(painel), painel);
    checa(
      'mostra a fase de aquecimento e o uso de disparos',
      /Número novo/.test(painel) && /17 de 20/.test(painel)
    );
    checa('mostra a pausa e que volta sozinho', /pausados até/.test(painel) && /Volta sozinho/.test(painel));
    checa('a barra de disparos fica em alerta (85%)', !!(await p.$('#wa-painel .mi-barra-alerta')));
    await p.click('#wa-criar-leads');
    await p.waitForTimeout(300);
    checa(
      'desligar "criar lead" vai para o servidor',
      est.chamadas.some(c => c.action === 'wa_opcoes' && c.criar_leads === false)
    );
    checa('nenhuma carga de XSS executou', (await p.evaluate(() => window.__XSS || 0)) === 0);
    await b.close();
    todos.push(...erros);
  }

  console.log('\n== Central: envio pelo WhatsApp ==');
  {
    const agora = new Date().toISOString();
    const est = {
      chamadas: [],
      ligado: { ligado: true },
      enviados: 0,
      envio: d => {
        est.enviados++;
        if (est.enviados > 1)
          return {
            __status: 429,
            corpo: {
              error: 'limite',
              motivo: 'Limite de mensagens da hora atingido.',
              volta_em: '2026-11-22T13:30:00Z'
            }
          };
        return { ok: true, id: 'm9', tipo: 'resposta', alerta: false, _d: d };
      }
    };
    const rotas = servidor(est);
    const { b, p, erros } = await abrir('thecred/atendimento', {
      modulos: ['crm', 'ATENDIMENTO'],
      antes: (url, metodo, corpo) => {
        if (url.includes('/rest/v1/a1_atendimentos'))
          return [
            {
              id: 'at1',
              case_id: 'c1',
              canal: 'whatsapp',
              status: 'aberta',
              pendente: true,
              ultima_em: agora,
              ultima_previa: 'Oi',
              versao: 1
            }
          ];
        if (url.includes('/rest/v1/a1_atendimento_mensagens')) return [];
        if (url.includes('/rest/v1/a1_cases') && url.includes('id=in.'))
          return [
            {
              id: 'c1',
              client_name: 'Joana',
              client_phone: '(98) 98123-4567',
              payload: { integracao: { origem: 'whatsapp' } }
            }
          ];
        if (url.includes('/rpc/a1_roleta_proximo_nome')) return null;
        if (url.includes('/rpc/a1_atend_enviar')) {
          est.rpcEnviar = true;
          return { ok: true };
        }
        return rotas(url, metodo, corpo);
      }
    });
    await p.evaluate(() => {
      window.__abriu = 0;
      window.open = () => {
        window.__abriu++;
        return null;
      };
    });
    await p.click('.at-item[data-id="at1"]');
    await p.waitForTimeout(400);
    checa(
      'o aviso diz que sai pelo WhatsApp da empresa',
      /WhatsApp da empresa/.test(await p.textContent('#at-compor-aviso'))
    );
    checa('o selo do canal é WhatsApp', !!(await p.$('.at-item[data-id="at1"] .canal-whatsapp')));
    await p.fill('#at-texto', 'Olá Joana!');
    await p.click('#at-enviar');
    await p.waitForTimeout(500);
    const env = est.chamadas.find(c => c.action === 'wa_enviar');
    checa(
      'a mensagem vai para a função, com a conversa e o texto',
      !!env && env.atendimento_id === 'at1' && env.texto === 'Olá Joana!'
    );
    checa(
      'não abre o wa.me nem grava pelo caminho antigo',
      (await p.evaluate(() => window.__abriu)) === 0 && !est.rpcEnviar
    );
    checa('a caixa fica limpa', (await p.inputValue('#at-texto')) === '');
    await p.fill('#at-texto', 'Mais uma');
    await p.click('#at-enviar');
    await p.waitForTimeout(500);
    const toast = await p.textContent('#at-toasts');
    checa(
      'no limite, avisa o motivo e quando volta',
      /Limite de mensagens da hora/.test(toast) && /Volta às/.test(toast),
      toast
    );
    checa('o texto não se perde', (await p.inputValue('#at-texto')) === 'Mais uma');
    checa(
      'o aviso do compositor passa a dizer que está pausado',
      /pausados até/.test(await p.textContent('#at-compor-aviso'))
    );
    await b.close();
    // o 429 do limite é o cenário do teste: o navegador registra no console
    todos.push(...erros.filter(e => !/status of 429/.test(e)));
  }

  console.log('\n== Central sem WhatsApp: continua abrindo o wa.me ==');
  {
    const agora = new Date().toISOString();
    const est = { chamadas: [], ligado: { ligado: false } };
    const rotas = servidor(est);
    const { b, p, erros } = await abrir('thecred/atendimento', {
      modulos: ['crm', 'ATENDIMENTO'],
      antes: (url, metodo, corpo) => {
        if (url.includes('/rest/v1/a1_atendimentos'))
          return [
            {
              id: 'at1',
              case_id: 'c1',
              canal: 'meta',
              status: 'aberta',
              pendente: true,
              ultima_em: agora,
              ultima_previa: 'Oi',
              versao: 1
            }
          ];
        if (url.includes('/rest/v1/a1_atendimento_mensagens')) return [];
        if (url.includes('/rest/v1/a1_cases') && url.includes('id=in.'))
          return [{ id: 'c1', client_name: 'Joana', client_phone: '(98) 98123-4567', payload: {} }];
        if (url.includes('/rpc/a1_roleta_proximo_nome')) return null;
        if (url.includes('/rpc/a1_atend_enviar')) return { ok: true };
        return rotas(url, metodo, corpo);
      }
    });
    await p.evaluate(() => {
      window.__abriu = 0;
      window.open = () => {
        window.__abriu++;
        return null;
      };
    });
    await p.click('.at-item[data-id="at1"]');
    await p.waitForTimeout(300);
    await p.fill('#at-texto', 'Oi');
    await p.click('#at-enviar');
    await p.waitForTimeout(400);
    checa('abre o wa.me como antes', (await p.evaluate(() => window.__abriu)) === 1);
    checa('e não chama a função do WhatsApp', !est.chamadas.some(c => c.action === 'wa_enviar'));
    await b.close();
    todos.push(...erros);
  }

  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
