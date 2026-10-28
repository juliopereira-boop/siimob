// Texto vindo do banco nunca entra cru no HTML: um nome com "<" viraria tag.
function esc(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

async function init() {
  let user;
  try { user = a1RequireAuth(['owner','admin']); } catch { return; }
  a1StartHeartbeat('tenant-admin');

  const slug = A1.slug;
  document.getElementById('nav-home').href        = `/${slug}/dashboard`;
  document.getElementById('user-display').textContent = `${user.name} · ${user.role}`;

  loadUsers();
  loadPartners();
}

async function loadUsers() {
  const users = await fetch(
    `${A1.rest('a1_users')}?role=not.eq.partner&order=created_at.asc&select=id,name,cpf,email,role,is_active,created_at,last_seen`,
    { headers: A1.headers() }
  ).then(r => r.json());

  document.getElementById('users-tbody').innerHTML = users.map(u => `
    <tr>
      <td>${esc(u.name)}</td>
      <td>${esc(u.cpf || '—')}</td>
      <td><span class="badge badge-gray">${esc(u.role)}</span></td>
      <td>${u.is_active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-red">Inativo</span>'}</td>
      <td style="font-size:.78rem;color:var(--muted)">${u.last_seen ? new Date(u.last_seen).toLocaleString('pt-BR') : 'Nunca'}</td>
      <td>
        <button class="btn btn-ghost" style="font-size:.75rem" onclick="toggleUser('${u.id}', ${u.is_active})">
          ${u.is_active ? 'Desativar' : 'Ativar'}
        </button>
      </td>
    </tr>`).join('');
}

async function loadPartners() {
  const partners = await fetch(
    `${A1.rest('a1_partners')}?order=created_at.asc`,
    { headers: A1.headers() }
  ).then(r => r.json());

  document.getElementById('partners-tbody').innerHTML = partners.length
    ? partners.map(p => `
        <tr>
          <td>${esc(p.name)}</td>
          <td><span class="badge badge-indigo">${esc(p.type)}</span></td>
          <td>${esc(p.cpf || '—')}</td>
          <td>${p.is_active ? '<span class="badge badge-green">Ativo</span>' : '<span class="badge badge-red">Inativo</span>'}</td>
          <td>${p.approved ? '<span class="badge badge-green">Sim</span>' : '<span class="badge badge-yellow">Não</span>'}</td>
          <td style="display:flex;gap:.3rem">
            ${!p.approved ? `<button class="btn btn-primary" style="font-size:.75rem" onclick="approvePartner('${p.id}')">Aprovar</button>` : ''}
            <button class="btn btn-ghost" style="font-size:.75rem" onclick="togglePartner('${p.id}', ${p.is_active})">${p.is_active ? 'Desativar' : 'Ativar'}</button>
          </td>
        </tr>`).join('')
    : '<tr><td colspan="6" style="color:var(--muted)">Nenhum parceiro cadastrado.</td></tr>';
}

function openNewUser()     { document.getElementById('user-modal').style.display    = 'flex'; }
function closeUserModal()  { document.getElementById('user-modal').style.display    = 'none'; }
function openNewPartner()  { document.getElementById('partner-modal').style.display = 'flex'; }
function closePartnerModal(){ document.getElementById('partner-modal').style.display = 'none'; }

async function createUser() {
  const btn = document.getElementById('u-btn');
  btn.disabled = true;
  btn.textContent = 'Criando...';
  try {
    await a1CreateUser({
      name:     document.getElementById('u-name').value,
      cpf:      document.getElementById('u-cpf').value,
      email:    document.getElementById('u-email').value,
      password: document.getElementById('u-pw').value,
      role:     document.getElementById('u-role').value
    });
    closeUserModal();
    toast('Usuário criado.', 'success');
    loadUsers();
  } catch (e) {
    document.getElementById('u-err').textContent = e.message;
    document.getElementById('u-err').style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Criar';
  }
}

async function createPartner() {
  const btn = document.getElementById('p-btn');
  btn.disabled = true;
  const hash = await hashPassword(document.getElementById('p-pw').value);

  const res = await fetch(A1.rest('a1_partners'), {
    method: 'POST',
    headers: A1.returnHeaders(),
    body: JSON.stringify({
      name:          document.getElementById('p-name').value,
      type:          document.getElementById('p-type').value,
      cpf:           document.getElementById('p-cpf').value.replace(/\D/g,''),
      email:         document.getElementById('p-email').value,
      phone:         document.getElementById('p-phone').value,
      password_hash: hash
    })
  });

  if (res.ok) {
    closePartnerModal();
    toast('Parceiro cadastrado.', 'success');
    loadPartners();
  } else {
    const err = await res.json();
    document.getElementById('p-err').textContent = err?.message?.includes('unique') ? 'CPF já cadastrado.' : 'Erro ao cadastrar.';
    document.getElementById('p-err').style.display = 'block';
  }
  btn.disabled = false;
}

async function toggleUser(id, current) {
  await fetch(`${A1.rest('a1_users')}?id=eq.${id}`, {
    method: 'PATCH', headers: A1.headers(),
    body: JSON.stringify({ is_active: !current })
  });
  toast(current ? 'Usuário desativado.' : 'Usuário ativado.', 'success');
  loadUsers();
}

async function approvePartner(id) {
  await fetch(`${A1.rest('a1_partners')}?id=eq.${id}`, {
    method: 'PATCH', headers: A1.headers(),
    body: JSON.stringify({ approved: true })
  });
  toast('Parceiro aprovado.', 'success');
  loadPartners();
}

async function togglePartner(id, current) {
  await fetch(`${A1.rest('a1_partners')}?id=eq.${id}`, {
    method: 'PATCH', headers: A1.headers(),
    body: JSON.stringify({ is_active: !current })
  });
  loadPartners();
}

function toast(msg, type = 'info') {
  const el   = document.getElementById('a1-toast');
  const item = document.createElement('div');
  item.className = `toast-item toast-${type}`;
  item.textContent = msg;
  el.appendChild(item);
  setTimeout(() => item.remove(), 3500);
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeUserModal(); closePartnerModal(); }
});

init();
// Esta tela não tem heartbeat, então vigia a chave geral por conta própria.
a1VigiarManutencao();
