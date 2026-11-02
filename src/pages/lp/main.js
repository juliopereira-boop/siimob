import { A1_KEY, A1_URL } from '../../shared/api/config.js';

const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Roda `fn` só enquanto `alvo` estiver na tela: animação fora de vista é bateria gasta. */
function enquantoVisivel(alvo, fn, ms) {
  let timer = null;
  const liga = () => {
    if (!timer) timer = setInterval(fn, ms);
  };
  const desliga = () => {
    clearInterval(timer);
    timer = null;
  };
  if (!('IntersectionObserver' in window)) return liga();
  new IntersectionObserver(([e]) => (e.isIntersecting ? liga() : desliga()), { threshold: 0.2 }).observe(
    alvo
  );
}

/* ── Assinatura: a planta viva ────────────────────────────────────────────
   Unidades são reservadas e vendidas enquanto a pessoa olha, e o resumo
   acompanha. É a Disposição contada em movimento. Dados fictícios.        */
(function () {
  const planta = document.getElementById('hp-planta');
  if (!planta) return;
  const toast = document.getElementById('hp-toast');
  const pct = document.getElementById('hp-pct');
  const contadores = [...document.querySelectorAll('#hp-resumo [data-st]')];
  const BLOCOS = ['T1', 'T2'];
  const ANDARES = [6, 5, 4, 3, 2, 1];
  const QUEM = [
    'Imobiliária Prisma',
    'Casa Nova Imóveis',
    'Ana, corretora',
    'Lar Certo Imóveis',
    'Bruno, corretor'
  ];

  // Situação inicial fixa: a mesma planta em toda visita.
  const VENDIDAS = [
    'T1-101',
    'T1-102',
    'T1-103',
    'T1-201',
    'T1-204',
    'T1-302',
    'T1-401',
    'T1-503',
    'T1-604',
    'T2-101',
    'T2-104',
    'T2-202',
    'T2-203',
    'T2-301',
    'T2-403',
    'T2-502',
    'T2-601',
    'T2-602'
  ];
  const RESERVADAS = ['T1-303', 'T2-404', 'T1-502'];
  const BLOQUEADAS = ['T1-104', 'T2-504'];

  const un = new Map();
  let seq = 124;

  function inicial() {
    un.forEach((u, c) => {
      u.st = VENDIDAS.includes(c)
        ? 'vendido'
        : RESERVADAS.includes(c)
          ? 'reservado'
          : BLOQUEADAS.includes(c)
            ? 'bloqueado'
            : 'disponivel';
      pintar(u);
    });
  }

  BLOCOS.forEach(b => {
    const bloco = document.createElement('div');
    bloco.className = 'pl-bloco';
    const tit = document.createElement('small');
    tit.textContent = b === 'T1' ? 'Torre 1' : 'Torre 2';
    bloco.appendChild(tit);
    ANDARES.forEach(a => {
      const andar = document.createElement('div');
      andar.className = 'pl-andar';
      const rot = document.createElement('span');
      rot.textContent = a + 'º';
      andar.appendChild(rot);
      for (let f = 1; f <= 4; f++) {
        const codigo = `${b}-${a}0${f}`;
        const el = document.createElement('div');
        el.className = 'un';
        el.textContent = `${a}0${f}`;
        andar.appendChild(el);
        un.set(codigo, { el, st: 'disponivel', codigo });
      }
      bloco.appendChild(andar);
    });
    planta.appendChild(bloco);
  });

  function pintar(u) {
    u.el.className = 'un' + (u.st === 'disponivel' ? '' : ' ' + u.st);
  }
  function resumo() {
    const n = { disponivel: 0, reservado: 0, vendido: 0, bloqueado: 0 };
    un.forEach(u => n[u.st]++);
    contadores.forEach(c => (c.textContent = String(n[c.dataset.st])));
    pct.textContent = Math.round((n.vendido / un.size) * 100) + '%';
    return n;
  }
  function avisar(html) {
    toast.innerHTML = html;
    toast.classList.add('on');
    setTimeout(() => toast.classList.remove('on'), 2100);
  }
  const de = st => [...un.values()].filter(u => u.st === st);
  const sorteio = l => l[Math.floor(Math.random() * l.length)];

  inicial();
  resumo();
  if (reduz) return;

  let passo = 0;
  enquantoVisivel(
    planta,
    () => {
      passo++;
      const livres = de('disponivel');
      // Estoque acabando: a demonstração recomeça em vez de travar na planta azul.
      if (livres.length < 8) {
        inicial();
        resumo();
        return;
      }
      const reservadas = de('reservado');
      if (passo % 3 === 0 && reservadas.length) {
        const u = sorteio(reservadas);
        u.st = 'vendido';
        pintar(u);
        u.el.classList.add('mudou');
        avisar(`Venda concluída · <b>${u.codigo}</b> vendida`);
      } else {
        const u = sorteio(livres);
        u.st = 'reservado';
        pintar(u);
        u.el.classList.add('mudou');
        seq++;
        avisar(`<b>RS-000${seq}</b> · ${u.codigo} reservada por ${sorteio(QUEM)}`);
      }
      resumo();
    },
    2600
  );
})();

/* ── A jornada: o pulso percorre as seis estações ─────────────────────── */
(function () {
  const trilho = document.getElementById('trilho');
  if (!trilho || reduz) return;
  const itens = [...trilho.children];
  let i = 0;
  const mostrar = () => {
    itens.forEach((li, k) => {
      li.classList.toggle('on', k === i);
      li.classList.toggle('foi', k < i);
    });
    i = (i + 1) % (itens.length + 1);
  };
  mostrar();
  enquantoVisivel(trilho, mostrar, 1500);
})();

/* ── Perfis: abas com teclado ─────────────────────────────────────────── */
(function () {
  const abas = [...document.querySelectorAll('.perfis-abas [role="tab"]')];
  if (!abas.length) return;
  function escolher(aba, foco) {
    abas.forEach(a => {
      const on = a === aba;
      a.setAttribute('aria-selected', String(on));
      a.tabIndex = on ? 0 : -1;
      document.getElementById(a.getAttribute('aria-controls')).hidden = !on;
    });
    if (foco) aba.focus();
  }
  abas.forEach((a, i) => {
    a.addEventListener('click', () => escolher(a, false));
    a.addEventListener('keydown', ev => {
      const d = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[ev.key];
      if (d) {
        ev.preventDefault();
        escolher(abas[(i + d + abas.length) % abas.length], true);
      } else if (ev.key === 'Home') {
        ev.preventDefault();
        escolher(abas[0], true);
      } else if (ev.key === 'End') {
        ev.preventDefault();
        escolher(abas[abas.length - 1], true);
      }
    });
  });
})();

/* ── Gráfico do painel: colunas finas, ponta arredondada, rótulo no último ── */
(function () {
  const svg = document.getElementById('tk-svg');
  if (!svg) return;
  const V = [4, 6, 5, 8, 7, 9];
  const NS = 'http://www.w3.org/2000/svg';
  const base = 86;
  const alto = 70;
  const larg = 22;
  const max = Math.max(...V);
  const linha = document.createElementNS(NS, 'line');
  linha.setAttribute('x1', '0');
  linha.setAttribute('x2', '300');
  linha.setAttribute('y1', String(base + 0.5));
  linha.setAttribute('y2', String(base + 0.5));
  linha.setAttribute('class', 'base');
  svg.appendChild(linha);
  V.forEach((v, i) => {
    const h = (v / max) * alto;
    const x = 25 + i * 50 - larg / 2;
    const y = base - h;
    const r = 4;
    const p = document.createElementNS(NS, 'path');
    p.setAttribute(
      'd',
      `M${x} ${base} V${y + r} Q${x} ${y} ${x + r} ${y} H${x + larg - r} Q${x + larg} ${y} ${x + larg} ${y + r} V${base} Z`
    );
    p.setAttribute('class', i === V.length - 1 ? 'col atual' : 'col');
    svg.appendChild(p);
    if (i === V.length - 1) {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', String(x + larg / 2));
      t.setAttribute('y', String(y - 5));
      t.setAttribute('text-anchor', 'middle');
      t.textContent = v + ' vendas';
      svg.appendChild(t);
    }
  });
})();

/* ── Revelar ao rolar ─────────────────────────────────────────────────────
   Só esconde o que ainda está abaixo da dobra. O que já aparece na primeira
   tela nunca pisca: some e volta seria pior do que não animar.            */
(function () {
  if (reduz || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver(
    ents => {
      ents.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.remove('rv-espera');
          io.unobserve(e.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );
  document.querySelectorAll('.rv').forEach(e => {
    if (e.getBoundingClientRect().top > window.innerHeight) {
      e.classList.add('rv-espera');
      io.observe(e);
    }
  });
})();

/* ── Envio do interesse ────────────────────────────────────────────────── */
(function () {
  const form = document.getElementById('lead-form');
  const btn = document.getElementById('lead-btn');
  const msg = document.getElementById('lead-msg');

  function aviso(texto, tipo) {
    msg.textContent = texto;
    msg.className = 'f-msg ' + tipo;
  }

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(form).entries());

    if (d.website) {
      aviso('Recebemos seu contato. Retornamos em breve.', 'ok');
      form.reset();
      return;
    }
    if (!d.name || !d.name.trim()) {
      aviso('Informe seu nome para continuarmos.', 'err');
      document.getElementById('ln').focus();
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email || '')) {
      aviso('Confira o e-mail: ele parece incompleto.', 'err');
      document.getElementById('le').focus();
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Enviando...';
    try {
      const res = await fetch(A1_URL + '/rest/v1/a1_leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: A1_KEY,
          Authorization: 'Bearer ' + A1_KEY,
          Prefer: 'return=minimal' /* a lista de leads não é legível pela chave pública */
        },
        body: JSON.stringify({
          name: (d.name || '').trim(),
          company: (d.company || '').trim(),
          email: (d.email || '').trim(),
          phone: (d.phone || '').trim(),
          segment: d.segment || null,
          volume: d.volume || null,
          message: (d.message || '').trim(),
          source: 'landing'
        })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      form.reset();
      aviso('Recebemos seu contato. Nossa equipe retorna em breve.', 'ok');
      btn.textContent = 'Enviado';
    } catch {
      aviso('Não conseguimos enviar agora. Tente de novo em instantes.', 'err');
      btn.disabled = false;
      btn.textContent = 'Tenho interesse';
    }
  });
})();
