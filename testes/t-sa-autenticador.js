// O login do superadmin pelo app autenticador.
//
// O PEDIDO DO DONO
//   "essa tela de autenticação, ser via autenticador, qr code, ta chato ficar
//    colocando esse service role"
//
// O que precisa valer:
//   - com o autenticador cadastrado, a tela pede o código, e não a chave;
//   - código certo abre o painel e, daí em diante, NENHUM pedido do painel vai
//     direto ao REST: todos passam pela função sa-proxy, com o token da sessão;
//   - a sessão sobrevive a recarregar a página, e sair encerra no banco;
//   - sessão vencida devolve ao login sem deixar o painel aberto;
//   - sem autenticador (ou sem a função publicada), fica a chave, como antes, e
//     entrar com ela oferece o cadastro com QR, cujo segredo é o mesmo do QR.
const { abrir, checa, resumo } = require('./comum');

const TOKEN = 'b'.repeat(64);
const visivel = (p, sel) =>
  p.evaluate(s => {
    const el = document.querySelector(s);
    return (
      !!el && !el.closest('[hidden]') && getComputedStyle(el).display !== 'none' && el.offsetParent !== null
    );
  }, sel);

/** Base32 (RFC 4648) para hex, para comparar o QR com o que vai ao banco. */
function base32ParaHex(b32) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of b32.replace(/\s/g, '')) bits += A.indexOf(c).toString(2).padStart(5, '0');
  let hex = '';
  for (let i = 0; i + 8 <= bits.length; i += 8)
    hex += parseInt(bits.slice(i, i + 8), 2)
      .toString(16)
      .padStart(2, '0');
  return hex;
}

(async () => {
  const todos = [];

  // ── 1. Com autenticador: código, sessão, proxy, recarga, sair ─────────────
  console.log('\nCom o autenticador cadastrado');
  {
    let loginCerto = false;
    const logins = [];
    const { b, p, erros } = await abrir('superadmin', {
      antes: (url, metodo, corpo) => {
        if (/\/functions\/v1\/sa-proxy\/status$/.test(url)) return { configurado: true };
        if (/\/functions\/v1\/sa-proxy\/login$/.test(url)) {
          logins.push(JSON.parse(corpo || '{}').codigo);
          return loginCerto
            ? { ok: true, token: TOKEN, expira_em: new Date(Date.now() + 3600e3).toISOString() }
            : { ok: false, erro: 'codigo_invalido', restantes: 1 };
        }
        if (/\/functions\/v1\/sa-proxy\/sair$/.test(url)) return { ok: true };
        return undefined;
      }
    });
    const pedidos = [];
    p.on('request', r => {
      if (/supabase\.co/.test(r.url())) pedidos.push({ url: r.url(), h: r.headers() });
    });

    checa('a tela pede o código do app', await visivel(p, '#sa-codigo'));
    checa('a chave fica escondida', !(await visivel(p, '#sa-key-input')));
    checa(
      'o campo é de código único (preenchimento do celular)',
      (await p.getAttribute('#sa-codigo', 'autocomplete')) === 'one-time-code'
    );

    await p.type('#sa-codigo', '123456');
    await p.waitForTimeout(500);
    checa(
      'no sexto dígito ele entra sozinho',
      logins.length === 1 && logins[0] === '123456',
      JSON.stringify(logins)
    );
    checa(
      'código errado avisa quantas tentativas restam',
      /Mais 1 tentativa/.test(await p.textContent('#sa-codigo-err'))
    );
    checa('e o painel continua fechado', !(await visivel(p, '#sa-panel')));

    loginCerto = true;
    pedidos.length = 0;
    await p.fill('#sa-codigo', '');
    await p.type('#sa-codigo', '654 321');
    await p.waitForTimeout(1500);
    checa('código certo abre o painel', await visivel(p, '#sa-panel'));
    checa(
      'o selo diz que a entrada foi pelo autenticador',
      (await p.textContent('#sa-modo-badge')).trim() === 'Autenticador'
    );
    const rest = pedidos.filter(x => /\/rest\/v1\//.test(x.url));
    checa('o painel carregou pelo banco', rest.length > 3, String(rest.length));
    checa(
      'todo pedido ao REST passou pela função sa-proxy',
      rest.every(x => x.url.includes('/functions/v1/sa-proxy/rest/v1/')),
      rest
        .filter(x => !x.url.includes('sa-proxy'))
        .map(x => x.url)
        .slice(0, 2)
        .join(' ')
    );
    checa(
      'com o token da sessão',
      rest.every(x => x.h['x-sa-sessao'] === TOKEN)
    );
    checa(
      'e sem chave de serviço no navegador (só a pública)',
      rest.every(x => x.h['apikey'] && x.h['apikey'] === (x.h['authorization'] || '').replace('Bearer ', ''))
    );

    // Upload de aviso: Storage não público também vai pela função.
    pedidos.length = 0;
    await p.evaluate(async () => {
      await fetch(`${document.getElementById('sa-url-input').value}/storage/v1/object/avisos/x.png`, {
        method: 'POST',
        body: 'x'
      });
      await fetch(`${document.getElementById('sa-url-input').value}/storage/v1/object/public/avisos/x.png`);
    });
    await p.waitForTimeout(200);
    checa(
      'upload ao Storage vai pela função',
      pedidos.some(x => /sa-proxy\/storage\/v1\/object\/avisos\/x\.png/.test(x.url))
    );
    checa(
      'endereço público do Storage não é desviado',
      pedidos.some(
        x => /\/storage\/v1\/object\/public\/avisos\/x\.png/.test(x.url) && !x.url.includes('sa-proxy')
      )
    );

    // Cartão na Plataforma
    await p.click('.sa-tab[data-name="plataforma"]');
    await p.waitForTimeout(500);
    checa('a Plataforma mostra o cartão de acesso', await visivel(p, '#sa-acesso-status'));

    // Recarregar mantém a sessão
    await p.reload({ waitUntil: 'load' });
    await p.waitForTimeout(1500);
    checa('recarregar a página mantém a sessão', await visivel(p, '#sa-panel'));

    // Sair
    pedidos.length = 0;
    await p.click('[data-acao="saLogout"]');
    await p.waitForTimeout(500);
    checa(
      'sair encerra a sessão na função',
      pedidos.some(x => /sa-proxy\/sair$/.test(x.url) && x.h['x-sa-sessao'] === TOKEN)
    );
    checa('e volta ao código', await visivel(p, '#sa-codigo'));
    checa(
      'sem sessão guardada na aba',
      (await p.evaluate(() => sessionStorage.getItem('a1_sa_sessao'))) === null
    );

    // Emergência: o link mostra a chave
    await p.click('[data-acao="saMostrarChave"]');
    checa('o link de emergência mostra a chave', await visivel(p, '#sa-key-input'));
    checa('com o caminho de volta ao código', await visivel(p, '#sa-voltar-codigo'));
    todos.push(...erros);
    await b.close();
  }

  // ── 2. Sessão vencida ─────────────────────────────────────────────────────
  console.log('\nSessão vencida');
  {
    const { b, p, erros } = await abrir('superadmin', {
      antes: url => {
        if (/sa-proxy\/status$/.test(url)) return { configurado: true };
        if (/sa-proxy\/login$/.test(url))
          return { ok: true, token: TOKEN, expira_em: new Date(Date.now() + 3600e3).toISOString() };
        return undefined;
      }
    });
    await p.type('#sa-codigo', '111111');
    await p.waitForTimeout(1500);
    // A partir daqui, a função diz que a sessão acabou.
    await p.route(/sa-proxy\/rest\//, r =>
      r.fulfill({ status: 401, contentType: 'application/json', body: '{"message":"sessao_invalida"}' })
    );
    await p.click('#tab-melhorias');
    await p.waitForTimeout(800);
    checa('a função recusando a sessão fecha o painel', !(await visivel(p, '#sa-panel')));
    checa(
      'e pede o código de novo, dizendo por quê',
      /sessão terminou/.test(await p.textContent('#sa-codigo-err'))
    );
    erros.splice(0, erros.length, ...erros.filter(e => !/401/.test(e)));
    todos.push(...erros);
    await b.close();
  }

  // ── 3. Sem autenticador: chave e cadastro com QR ──────────────────────────
  console.log('\nPrimeiro acesso (sem autenticador)');
  {
    const cadastros = [];
    let cadastroOk = false;
    let destravado = false;
    const { b, p, erros } = await abrir('superadmin', {
      antes: (url, metodo, corpo) => {
        if (/sa-proxy\/status$/.test(url)) return { configurado: false };
        if (/\/rpc\/a1_sa_totp_status$/.test(url))
          return { configurado: cadastroOk, cadastrado_em: null, travado: !destravado && cadastroOk };
        if (/\/rpc\/a1_sa_destravar$/.test(url)) {
          destravado = true;
          return null;
        }
        if (/\/rpc\/a1_sa_totp_cadastrar$/.test(url)) {
          cadastros.push(JSON.parse(corpo || '{}'));
          cadastroOk = cadastros.length > 1;
          return cadastroOk ? { ok: true } : { ok: false, erro: 'codigo_invalido' };
        }
        return undefined;
      }
    });
    checa('a tela mostra a chave', await visivel(p, '#sa-key-input'));
    checa('explicando que é o primeiro acesso', await visivel(p, '#sa-gate-primeiro'));
    checa('sem o link de volta ao código (não há autenticador)', !(await visivel(p, '#sa-voltar-codigo')));

    await p.fill('#sa-key-input', 'chave');
    await p.click('button:has-text("Entrar como Superadmin")');
    await p.waitForTimeout(1500);
    checa('a chave abre o painel', await visivel(p, '#sa-panel'));
    checa(
      'o selo diz que a entrada foi pela chave',
      (await p.textContent('#sa-modo-badge')).trim() === 'Service Role ativo'
    );
    checa('o cadastro do autenticador abre sozinho', await visivel(p, '#modal-sa-totp .totp-qr svg'));
    const seg = (await p.textContent('#totp-seg')).trim();
    checa(
      'a chave para digitar à mão aparece em grupos de 4',
      /^([A-Z2-7]{4} ){7}[A-Z2-7]{4}$/.test(seg),
      seg
    );

    await p.fill('#totp-codigo', '000000');
    await p.click('#totp-ativar');
    await p.waitForTimeout(400);
    checa(
      'código que não confere avisa e não fecha',
      (await visivel(p, '#totp-err')) && (await visivel(p, '#modal-sa-totp .totp-qr'))
    );
    checa(
      'o segredo enviado é o mesmo do QR',
      cadastros[0] && cadastros[0].p_segredo_hex === base32ParaHex(seg),
      JSON.stringify(cadastros[0])
    );
    checa('segredo de 20 bytes em hex', /^[0-9a-f]{40}$/.test((cadastros[0] || {}).p_segredo_hex || ''));

    await p.fill('#totp-codigo', '123 456');
    await p.click('#totp-ativar');
    await p.waitForTimeout(500);
    checa(
      'código certo ativa e fecha',
      cadastros[1] && cadastros[1].p_codigo === '123456' && !(await visivel(p, '#modal-sa-totp .totp-qr'))
    );

    await p.click('.sa-tab[data-name="plataforma"]');
    await p.waitForTimeout(500);
    checa(
      'a Plataforma passa a mostrar o autenticador ativo',
      /Autenticador ativo/.test(await p.textContent('#sa-acesso-status'))
    );
    checa('com a opção de trocar', (await p.textContent('#sa-btn-totp')).trim() === 'Trocar autenticador');
    checa('login travado aparece no cartão', /travado/.test(await p.textContent('#sa-acesso-status')));
    await p.click('#sa-btn-destravar');
    await p.waitForTimeout(500);
    checa('Liberar login destrava e o botão some', destravado && !(await visivel(p, '#sa-btn-destravar')));
    todos.push(...erros);
    await b.close();
  }

  // ── 4. Função ainda não publicada ─────────────────────────────────────────
  console.log('\nFunção ainda não publicada');
  {
    const { b, p, erros } = await abrir('superadmin');
    checa(
      'sem resposta da função, fica a chave como antes',
      (await visivel(p, '#sa-key-input')) && !(await visivel(p, '#sa-codigo'))
    );
    checa('sem prometer primeiro acesso', !(await visivel(p, '#sa-gate-primeiro')));
    todos.push(...erros);
    await b.close();
  }

  process.exit(resumo(todos) ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
