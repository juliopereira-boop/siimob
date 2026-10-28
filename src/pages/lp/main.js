/* ── Assinatura: pipeline vivo ────────────────────────────────────────────
   Um processo trava na Conformidade, acumula dias, vira âmbar e é capturado.
   É a promessa do produto contada em movimento — não é enfeite.            */
(function(){
  const ETAPAS = ['Cadastro','Análise','Conformidade','Assinatura','Repasse'];
  const pipe = document.getElementById('pipe');
  const alerta = document.getElementById('alert');
  if (!pipe) return;
  const cols = [...pipe.querySelectorAll('.col')];
  cols.forEach((c,i)=>{
    const l = document.createElement('div');
    l.className = 'col-label'; l.textContent = ETAPAS[i];
    l.style.left = 0; l.style.padding = '9px 8px'; c.appendChild(l);
  });

  const ELENCO = [
    {n:'Maria S. Andrade',  v:'R$ 210.000', star:true},
    {n:'João P. Fernandes', v:'R$ 170.000'},
    {n:'Ana L. Costa',      v:'R$ 178.000'},
    {n:'Carlos E. Nunes',   v:'R$ 154.000'}
  ];

  const cards = ELENCO.map(p=>{
    const el = document.createElement('div');
    el.className = 'pcard';
    el.innerHTML = '<b>'+p.n+'</b><span></span>';
    pipe.appendChild(el);
    return {el, dias:0, col:0, meta:p, sub:el.querySelector('span')};
  });

  function posicionar(){
    const larg = cols[0].getBoundingClientRect().width;
    cards.forEach(c=>{
      c.el.style.width = larg + 'px';
      const y = 34 + c.linha * 62;
      c.el.style.transform = 'translate(' + (c.col * (larg + 9)) + 'px,' + y + 'px)';
    });
  }
  function relayout(){
    cols.forEach((_,i)=>{
      let linha = 0;
      cards.filter(c=>c.col===i).forEach(c=>{ c.linha = linha++; });
    });
    posicionar();
  }

  cards.forEach((c,i)=>{ c.col = i===0 ? 2 : (i===1 ? 0 : (i===2 ? 1 : 3)); });
  cards[0].dias = 4;
  relayout();
  window.addEventListener('resize', relayout);

  const reduz = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function pintar(){
    cards.forEach(c=>{
      // Boolean() obrigatório: classList.toggle(cls, undefined) INVERTE a classe
      // em vez de removê-la — sem isto os cartões normais piscavam em âmbar.
      const parado = Boolean(c.meta.star) && c.dias >= 18;
      const pronto = c.col >= 4;
      c.el.classList.toggle('warn', parado && !pronto);
      c.el.classList.toggle('done', pronto);
      c.sub.textContent = pronto ? c.meta.v + ' · repassado'
                        : parado ? c.dias + ' dias parado'
                        : c.meta.v + ' · ' + c.dias + 'd';
    });
    const travado = cards[0].el.classList.contains('warn');
    alerta.classList.toggle('show', travado);
    if (travado) document.getElementById('alert-txt').textContent =
      'Parado há ' + cards[0].dias + ' dias — avisamos você';
  }
  pintar();
  if (reduz) { cards[0].dias = 18; pintar(); return; }

  let t = 0;
  setInterval(()=>{
    t++;
    // o processo em destaque acumula dias parado até ser destravado
    if (cards[0].col === 2 && cards[0].dias < 18) cards[0].dias += 3;
    else if (cards[0].dias >= 18 && t % 3 === 0) cards[0].col++;
    // os demais caminham normalmente
    cards.slice(1).forEach((c,i)=>{ if ((t + i) % 3 === 0) { c.col++; c.dias += 2; } });
    cards.forEach(c=>{
      if (c.col > 4) { c.col = 0; c.dias = 0; }
    });
    relayout(); pintar();
  }, 1700);
})();

/* ── Revelar ao rolar ──────────────────────────────────────────────────── */
(function(){
  const alvos = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window)) { alvos.forEach(e=>e.classList.add('in')); return; }
  const io = new IntersectionObserver((ents)=>{
    ents.forEach(e=>{ if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, {threshold:.12, rootMargin:'0px 0px -40px 0px'});
  alvos.forEach(e=>io.observe(e));
})();

/* ── Envio do interesse ────────────────────────────────────────────────── */
(function(){
  const form = document.getElementById('lead-form');
  const btn  = document.getElementById('lead-btn');
  const msg  = document.getElementById('lead-msg');

  function aviso(texto, tipo){ msg.textContent = texto; msg.className = 'f-msg ' + tipo; }

  form.addEventListener('submit', async (ev)=>{
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(form).entries());

    if (d.website) { aviso('Recebemos seu contato. Retornamos em breve.', 'ok'); form.reset(); return; }
    if (!d.name || !d.name.trim())  { aviso('Informe seu nome para continuarmos.', 'err'); document.getElementById('ln').focus(); return; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email || '')) { aviso('Confira o e-mail: ele parece incompleto.', 'err'); document.getElementById('le').focus(); return; }

    btn.disabled = true; btn.textContent = 'Enviando...';
    try {
      const res = await fetch(A1_URL + '/rest/v1/a1_leads', {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'apikey': A1_KEY,
          'Authorization':'Bearer ' + A1_KEY,
          'Prefer':'return=minimal'   /* a lista de leads não é legível pela chave pública */
        },
        body: JSON.stringify({
          name:(d.name||'').trim(), company:(d.company||'').trim(), email:(d.email||'').trim(),
          phone:(d.phone||'').trim(), segment:d.segment||null, volume:d.volume||null,
          message:(d.message||'').trim(), source:'landing'
        })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      form.reset();
      aviso('Recebemos seu contato. Nossa equipe retorna em breve.', 'ok');
      btn.textContent = 'Enviado';
    } catch (e) {
      aviso('Não conseguimos enviar agora. Tente de novo em instantes.', 'err');
      btn.disabled = false; btn.textContent = 'Tenho interesse';
    }
  });
})();
