// ─── Mural de Avisos: o lado de quem usa o sistema ───────────────────────────
// Depois do login, mostra num pop-up os avisos que o superadmin publicou para o
// tipo daquele usuário. Aviso lido não volta — e o "lido" fica no banco, não no
// navegador, senão bastaria abrir do celular para o mesmo aviso reaparecer.
//
// Nenhuma regra de quem-vê-o-quê é decidida aqui: quem filtra é a função
// a1_avisos_para_mim, no banco. Decidir isso no navegador seria decidir num
// lugar onde qualquer pessoa consegue mexer.

const A1Avisos = (() => {

  // O tipo do usuário, no vocabulário do mural.
  function publicoDoUsuario(u) {
    if (!u) return '';
    if (u.role === 'owner' || u.role === 'admin') return 'gestor';
    if (u.role === 'partner') {
      const t = (u.type || '').toLowerCase();
      if (t === 'analista')    return 'analista';
      if (t === 'corretor')    return 'corretor';
      if (t === 'despachante') return 'despachante';
      return 'correspondente';
    }
    return 'usuario';
  }

  function chaveDoUsuario(u) {
    return `${u.tenant_id}::${u.partner_id || u.id}`;
  }

  const esc = s => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  // Só aceitamos endereço de arquivo; um "javascript:..." vindo do banco não
  // pode virar link clicável na tela de ninguém.
  function urlSegura(u) {
    if (!u) return '';
    const s = String(u).trim();
    return /^https?:\/\//i.test(s) ? s : '';
  }

  function estilo() {
    if (document.getElementById('a1-avisos-css')) return;
    const st = document.createElement('style');
    st.id = 'a1-avisos-css';
    st.textContent = `
      .av-fundo{position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:9500;
        display:flex;align-items:center;justify-content:center;padding:1.25rem}
      .av-caixa{background:#fff;border-radius:14px;max-width:560px;width:100%;
        max-height:88vh;display:flex;flex-direction:column;overflow:hidden;
        box-shadow:0 20px 60px rgba(0,0,0,.28)}
      .av-topo{padding:1rem 1.25rem;border-bottom:1px solid #E2E8F0;display:flex;
        align-items:flex-start;gap:.75rem}
      .av-selo{display:inline-block;font-size:.62rem;font-weight:800;text-transform:uppercase;
        letter-spacing:.08em;color:#3D5CC8;background:#EEF2FF;border-radius:5px;padding:.15rem .45rem;margin-bottom:.3rem}
      .av-titulo{font-size:1.05rem;font-weight:800;letter-spacing:-.02em;color:#0F172A;line-height:1.35}
      .av-x{margin-left:auto;width:28px;height:28px;border:none;border-radius:7px;background:#F1F5F9;
        color:#475569;cursor:pointer;font-size:.9rem;flex-shrink:0}
      .av-x:hover{background:#E2E8F0}
      .av-corpo{padding:1.1rem 1.25rem;overflow-y:auto;font-size:.88rem;line-height:1.65;color:#334155}
      .av-corpo p{margin:0 0 .7rem}
      .av-corpo img,.av-corpo video{max-width:100%;border-radius:9px;display:block;margin:.5rem 0}
      .av-rodape{padding:.85rem 1.25rem;border-top:1px solid #E2E8F0;display:flex;
        align-items:center;gap:.6rem}
      .av-conta{font-size:.75rem;color:#94A3B8;margin-right:auto}
      .av-btn{padding:.55rem 1.1rem;border:1px solid #E2E8F0;border-radius:8px;background:#fff;
        color:#0F172A;font-size:.82rem;font-weight:700;cursor:pointer;font-family:inherit}
      .av-btn-p{background:#3D5CC8;border-color:#3D5CC8;color:#fff}
      .av-btn-p:hover{background:#1E3A8A}
    `;
    document.head.appendChild(st);
  }

  let fila = [], atual = 0, usuario = null;

  function desenhar() {
    const a = fila[atual];
    if (!a) { fechar(); return; }
    let fundo = document.getElementById('a1-avisos');
    if (!fundo) {
      fundo = document.createElement('div');
      fundo.id = 'a1-avisos';
      fundo.className = 'av-fundo';
      document.body.appendChild(fundo);
    }
    const img = urlSegura(a.imagem_url);
    const vid = urlSegura(a.video_url);
    // Vídeo do YouTube/Vimeo entra como moldura; arquivo entra como <video>.
    const molde = /youtube\.com|youtu\.be|vimeo\.com/i.test(vid);
    const idYt = (vid.match(/(?:v=|youtu\.be\/|embed\/)([\w-]{6,})/) || [])[1];

    fundo.innerHTML = `
      <div class="av-caixa" role="dialog" aria-modal="true" aria-labelledby="av-t">
        <div class="av-topo">
          <div>
            <span class="av-selo">Aviso${a.fixado ? ' fixado' : ''}</span>
            <div class="av-titulo" id="av-t">${esc(a.titulo)}</div>
          </div>
          <button class="av-x" onclick="A1Avisos.fechar()" aria-label="Fechar">&#x2715;</button>
        </div>
        <div class="av-corpo">
          ${img ? `<img src="${esc(img)}" alt="">` : ''}
          ${vid ? (molde && idYt
              ? `<iframe width="100%" height="280" style="border:0;border-radius:9px"
                   src="https://www.youtube.com/embed/${esc(idYt)}" allowfullscreen
                   title="Vídeo do aviso"></iframe>`
              : `<video src="${esc(vid)}" controls style="width:100%"></video>`)
            : ''}
          ${(a.corpo || '').split(/\n{2,}/).filter(Boolean)
              .map(par => `<p>${esc(par).replace(/\n/g,'<br>')}</p>`).join('')}
        </div>
        <div class="av-rodape">
          <span class="av-conta">${fila.length > 1 ? `${atual + 1} de ${fila.length}` : ''}</span>
          ${atual + 1 < fila.length
            ? `<button class="av-btn btn-p av-btn-p" onclick="A1Avisos.proximo()">Próximo</button>`
            : `<button class="av-btn av-btn-p" onclick="A1Avisos.fechar()">Entendi</button>`}
        </div>
      </div>`;
  }

  // Marcar como lido é o que faz o aviso não voltar. Se falhar, tudo bem: o
  // aviso reaparece no próximo acesso, que é melhor do que sumir sem ter sido
  // visto.
  async function marcarLido(aviso) {
    if (!aviso || aviso.fixado) return;
    try {
      await fetch(A1.rest('a1_avisos_lidos'), {
        method: 'POST',
        headers: A1.headers({ 'Prefer': 'resolution=ignore-duplicates' }),
        body: JSON.stringify({ aviso_id: aviso.id, user_key: chaveDoUsuario(usuario) })
      });
    } catch {}
  }

  function proximo() {
    marcarLido(fila[atual]);
    atual++;
    if (atual >= fila.length) fechar(); else desenhar();
  }

  function fechar() {
    marcarLido(fila[atual]);
    const el = document.getElementById('a1-avisos');
    if (el) el.remove();
    fila = []; atual = 0;
  }

  async function mostrar() {
    try {
      usuario = A1.user;
      if (!usuario || !A1.token) return;
      const res = await fetch(A1.rpc('a1_avisos_para_mim'), {
        method: 'POST', headers: A1.headers(),
        body: JSON.stringify({
          p_publico: publicoDoUsuario(usuario),
          p_user_key: chaveDoUsuario(usuario)
        })
      });
      if (!res.ok) return;                       // sem mural instalado: segue a vida
      const lista = await res.json().catch(() => []);
      if (!Array.isArray(lista) || !lista.length) return;
      fila = lista; atual = 0;
      estilo();
      desenhar();
    } catch { /* aviso nunca pode atrapalhar quem está trabalhando */ }
  }

  return { mostrar, fechar, proximo, publicoDoUsuario };
})();

// Roda sozinho no carregamento das telas que incluírem este arquivo.
document.addEventListener('DOMContentLoaded', () => setTimeout(() => A1Avisos.mostrar(), 900));
