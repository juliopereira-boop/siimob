# WhatsApp (Evolution) e OpenAI na Central de atendimento

Pacote da Central (módulo `ATENDIMENTO`). Sem a licença, nada disso aparece nem roda.

## Como as peças conversam

```
Celular da empresa ──QR──> Evolution (servidor Hostinger/Easypanel)
                              │  aviso a cada mensagem (webhook)
                              ▼
            Supabase: whatsapp-webhook ──> a1_wa_receber ──> Central de atendimento
                                                               │
Tela (Central / Configurações) ──> atendimento-conectores ─────┘
                                     │ envia texto (com limites)   │ testa a chave
                                     ▼                             ▼
                                  Evolution                     OpenAI
```

- Um servidor Evolution para a plataforma inteira. Cada cliente ganha a própria
  instância (`siimob-<slug>`), criada pelo botão "Conectar WhatsApp".
- O endereço do aviso leva um token só daquela conexão. O banco guarda só o hash.
- A chave global da Evolution e a chave da OpenAI ficam nos segredos do Supabase.
  O navegador nunca vê nenhuma delas.

## 1. Servidor (Hostinger + Easypanel)

1. VPS Hostinger com Ubuntu 24.04. Para Evolution + n8n, o mínimo confortável é
   2 vCPU / 8 GB (plano KVM 2).
2. Instale o Easypanel. A Hostinger tem um template com Easypanel pronto. Se não
   usar o template, rode como root:
   `curl -sSL https://get.easypanel.io | sh`
3. No Easypanel, crie um projeto (ex.: `siimob`) e adicione:
   - **Evolution API** (template do Easypanel). Ele já sobe o Postgres e o Redis
     da Evolution.
   - **n8n** (opcional, para automações fora do SIIMOB).
4. Domínio com HTTPS para a Evolution (ex.: `evo.seudominio.com.br`):
   - crie um registro DNS A apontando para o IP da VPS;
   - no Easypanel, em Domains do serviço, cadastre o domínio. O certificado sai sozinho.
   - O SIIMOB só aceita `https://`.
5. Variáveis da Evolution (Environment, no Easypanel):
   - `AUTHENTICATION_API_KEY`: uma chave longa e aleatória, por exemplo
     `openssl rand -hex 32`. É a `SIIMOB_EVOLUTION_KEY`.
   - `SERVER_URL=https://evo.seudominio.com.br`
   - `CONFIG_SESSION_PHONE_CLIENT=SIIMOB` e `CONFIG_SESSION_PHONE_NAME=Chrome`:
     é o nome que aparece em "Aparelhos conectados".
   - `WEBHOOK_GLOBAL_ENABLED=false`: o SIIMOB configura o aviso por instância.
   - `DEL_INSTANCE=false`
   - Deixe o resto como o template trouxer (banco e Redis).
6. Teste no navegador: `https://evo.seudominio.com.br` deve responder com a
   versão da Evolution.

## 2. Segredos no Supabase

Supabase › Project Settings › Edge Functions › Secrets:

| Segredo | Valor |
|---|---|
| `SIIMOB_EVOLUTION_URL` | `https://evo.seudominio.com.br` (sem barra no fim) |
| `SIIMOB_EVOLUTION_KEY` | o `AUTHENTICATION_API_KEY` da Evolution |
| `SIIMOB_OPENAI_API_KEY` | opcional: chave da plataforma, usada por quem não cadastrar a própria |

## 3. Banco e funções (precisa de autorização do dono)

1. SQL Editor: rodar `database/migrations/2026-11-22_atendimento_conectores.sql`.
   No fim do arquivo está como conferir.
2. Publicar as funções, todas com `verify_jwt` desligado:
   - `atendimento-conectores`: a autorização é a sessão do SIIMOB;
   - `whatsapp-webhook`: a autorização é o token da conexão.
3. Mandar a tela para a main só depois dos passos 1 e 2.

## 4. Conectar um cliente

1. Configurações › Integrações › WhatsApp › **Conectar WhatsApp**.
2. No celular da empresa: WhatsApp › Aparelhos conectados › Conectar um aparelho.
   Aponte para o QR. Também dá para usar o código de pareamento.
3. A tela confere sozinha a cada 4 s e mostra "Conectado".
4. Nas Configurações › Integrações › OpenAI, cole a chave da empresa e salve. Ela é
   testada antes de ser guardada. Se a plataforma tiver chave, isso é opcional.

## Limites anti-bloqueio

O WhatsApp não publica limite para conexão não oficial (Baileys/Evolution).
Nenhum número abaixo garante que o número não seja bloqueado. Os valores são
heurísticas conservadoras tiradas de guias da comunidade.

| Regra | Valor |
|---|---|
| Qualquer mensagem | 8/min, 150/h, 800/dia |
| Conversa iniciada + campanha, dias 1 a 3 do número | 20/dia, 8/h |
| dias 4 a 7 | 40/dia, 12/h |
| dias 8 a 14 | 80/dia, 20/h |
| dias 15 a 30 | 150/dia, 30/h |
| mais de 30 dias | 250/dia, 40/h |
| Campanha | 20 a 60 s entre mensagens, pausa de 5 a 15 min a cada 20 |
| Falhas | 5 falhas na hora pausam tudo por 1 hora |

- **Resposta** é quando o lead escreveu nas últimas 24 h. Respostas não gastam
  a cota de disparo frio.
- No teto, o envio é segurado:
  - a tela da Central mostra o motivo e quando volta;
  - Configurações mostra a faixa de pausa e as barras de uso;
  - o envio volta sozinho quando a janela abre vaga.
- A idade do número conta a partir da primeira conexão no SIIMOB. Se o cliente
  trocar de número, o aquecimento recomeça.
- Ajuste fino: `supabase/functions/atendimento-conectores/limites.mjs` (com testes
  em `testes/conectores/limites.test.mjs`).

### Riscos que o código não resolve

- **IP de datacenter.** A VPS pesa contra; não há o que o código faça.
- **Lista fria.** Gente que nunca falou com a empresa.
- **Texto idêntico.** A mesma mensagem para muita gente.

Para volume alto de campanha, o caminho seguro é a API oficial (WhatsApp Cloud
API).
