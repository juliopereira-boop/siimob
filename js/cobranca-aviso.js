// ─── Tarja de cobrança em atraso ─────────────────────────────────────────────
// Quando o cliente tem mês em atraso, uma faixa vermelha desce do topo da tela
// pedindo contato. Ela é PARTE DA PÁGINA, não fica presa na tela: ao rolar para
// baixo ela sai junto com o resto. É esse o comportamento pedido — o aviso
// aparece, se faz notar, e não fica atrapalhando quem está trabalhando.
//
// O estado vem de a1_config key='billing', gravado pelo superadmin. Ninguém
// aqui decide se está em atraso: o navegador só desenha o que o banco diz.
// Como a1_config é isolado por cliente na RLS, cada empresa lê apenas o
// próprio. Nenhum dado de cobrança de um cliente alcança outro.

const A1Cobranca = (() => {

  // ─── Contato da cobrança ───────────────────────────────────────────────────
  // Muda aqui e muda em todas as telas. Nada disso está espalhado no código.
  const CONTATO = {
    email: 'gestao@poupgestao.com',
    telefone: '(98) 98180-9264',
    telefoneWhats: '5598981809264',       // usado no link do WhatsApp
    // true = só gestor e admin veem a tarja; false = todo mundo do cliente vê.
    // O modelo do mercado é mostrar para todos: a equipe cobra o gestor. Mas a
    // escolha é de quem cobra, não do código.
    soGestor: false,
  };

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  const MESES = ['janeiro','fevereiro','março','abril','maio','junho',
                 'julho','agosto','setembro','outubro','novembro','dezembro'];

  // Mesma regra do superadmin: atraso marcado à mão, ou vencimento passado sem
  // pagamento.
  //
  // O CUIDADO QUE CUSTOU CARO NO TESTE: varrer meses para trás às cegas fazia a
  // tarja acusar "17 mensalidades em aberto desde abril de 2025" num cliente
  // que entrou este ano — porque todo mês anterior sem registro parecia
  // vencido. Cobrança errada é pior do que cobrança nenhuma. Então a varredura
  // começa no PRIMEIRO MÊS QUE TEM REGISTRO: é a data em que essa cobrança
  // passou a existir. Sem registro nenhum, só o mês corrente pode estar em
  // atraso — errar para menos, aqui, é o lado certo de errar.
  function mesesEmAtraso(billing) {
    if (!billing) return [];
    const pagos = billing.paid || {};
    const dia = parseInt(billing.due_day) || 0;
    const agora = new Date();

    const fora = Object.keys(pagos).filter(k => (pagos[k] || {}).atraso);

    if (dia) {
      const registros = Object.keys(pagos).sort();
      const inicio = registros.length ? registros[0]
                                      : `${agora.getFullYear()}-${String(agora.getMonth()+1).padStart(2,'0')}`;
      for (let i = 0; i < 24; i++) {
        const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
        const chave = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        if (chave < inicio) break;                    // antes da cobrança existir
        const r = pagos[chave];
        if (r && (r.paid || r.atraso)) continue;       // já resolvido ou já contado
        const venc = new Date(d.getFullYear(), d.getMonth(), dia, 23, 59, 59);
        if (agora > venc) fora.push(chave);
      }
    }
    return [...new Set(fora)].sort();
  }

  function porExtenso(chave) {
    const [a, m] = String(chave).split('-');
    const i = parseInt(m, 10) - 1;
    return MESES[i] ? `${MESES[i]} de ${a}` : chave;
  }

  function estilo() {
    if (document.getElementById('a1-cob-css')) return;
    const st = document.createElement('style');
    st.id = 'a1-cob-css';
    st.textContent = `
      .a1-cob{background:#DC2626;color:#fff;text-align:center;
        padding:.85rem 1.25rem;font-size:.87rem;font-weight:700;line-height:1.5;
        box-shadow:0 2px 10px rgba(220,38,38,.28);position:relative;z-index:400;
        /* Desce do topo: a faixa nasce recolhida e abre. Como ela ocupa espaço
           de verdade no fluxo, a página inteira acompanha o movimento. */
        animation:a1CobDesce .45s cubic-bezier(.22,1,.36,1) both}
      @keyframes a1CobDesce{
        from{max-height:0;padding-top:0;padding-bottom:0;opacity:0}
        to{max-height:220px;padding-top:.85rem;padding-bottom:.85rem;opacity:1}
      }
      @media (prefers-reduced-motion:reduce){ .a1-cob{animation:none} }
      .a1-cob a{color:#fff;text-decoration:underline;font-weight:800;
        text-underline-offset:2px;white-space:nowrap}
      .a1-cob a:hover{text-decoration:none}
      .a1-cob small{display:block;font-weight:600;font-size:.76rem;
        color:rgba(255,255,255,.85);margin-top:.15rem}
      @media(max-width:640px){ .a1-cob{font-size:.8rem;padding:.75rem 1rem} }
    `;
    document.head.appendChild(st);
  }

  function desenhar(atrasados) {
    if (document.getElementById('a1-cobranca')) return;
    estilo();
    const faixa = document.createElement('div');
    faixa.id = 'a1-cobranca';
    faixa.className = 'a1-cob';
    faixa.setAttribute('role', 'alert');

    const quantos = atrasados.length;
    const detalhe = quantos === 1
      ? `Mensalidade de <b>${esc(porExtenso(atrasados[0]))}</b> em aberto.`
      : `<b>${quantos} mensalidades</b> em aberto (a mais antiga de ${esc(porExtenso(atrasados[0]))}).`;

    faixa.innerHTML =
      `Evite a suspensão do seu ambiente SIIMOB, entre em contato com ` +
      `<a href="mailto:${esc(CONTATO.email)}">${esc(CONTATO.email)}</a> ou ` +
      `<a href="https://wa.me/${esc(CONTATO.telefoneWhats)}" target="_blank" rel="noopener noreferrer"
         >${esc(CONTATO.telefone)}</a>` +
      `<small>${detalhe}</small>`;

    document.body.insertBefore(faixa, document.body.firstChild);
  }

  async function verificar() {
    try {
      const u = A1.user;
      if (!u || !A1.token) return;
      if (CONTATO.soGestor && u.role !== 'owner' && u.role !== 'admin') return;

      const res = await fetch(`${A1.rest('a1_config')}?key=eq.billing&select=value`,
        { headers: A1.headers() });
      if (!res.ok) return;                       // sem cobrança configurada: segue a vida
      const linhas = await res.json().catch(() => []);
      if (!Array.isArray(linhas) || !linhas.length) return;

      let billing = linhas[0].value;
      if (typeof billing === 'string') { try { billing = JSON.parse(billing); } catch { return; } }

      const atrasados = mesesEmAtraso(billing);
      if (atrasados.length) desenhar(atrasados);
    } catch { /* cobrança nunca pode derrubar a tela de quem está trabalhando */ }
  }

  return { verificar, mesesEmAtraso, CONTATO };
})();

// Roda no carregamento das telas que incluírem este arquivo.
document.addEventListener('DOMContentLoaded', () => setTimeout(() => A1Cobranca.verificar(), 400));
