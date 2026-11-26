# WhatsApp oficial (API da Meta pela Coexy)

Pacote da Central (módulo `ATENDIMENTO`). O oficial é o canal principal da Central,
das Integrações e da ELIA. A Evolution (QR Code, `docs/WHATSAPP-EVOLUTION.md`) fica
de reserva automática.

## Como as peças conversam

```
Número do cliente ──página de conexão (login da Meta)──> Coexy (conta da plataforma)
                                                           │ avisos (webhook, HMAC)
                                                           ▼
             Supabase: coexy-webhook ──> a1_wa_receber_oficial ──> Central / ELIA
                                                                      │
Tela (Central / Integrações / ELIA) ──> atendimento-conectores ───────┘
                                          │ rota.mjs
                       ┌──────────────────┴──────────────────┐
                       ▼                                     ▼
          Coexy meta-proxy (oficial)                Evolution (reserva)
```

- Uma conta Coexy para a plataforma. Cada cliente ganha um canal (`SIIMOB <slug>`),
  criado pelo botão "Conectar WhatsApp oficial" em Configurações › Integrações.
- O cliente abre a página de conexão (link da Coexy, sem o token) com o login do
  Facebook que administra o WhatsApp da empresa. Dá para manter o app WhatsApp
  Business no celular (coexistência).
- Um webhook só para a plataforma inteira. O SIIMOB cria na primeira conexão e
  guarda o segredo HMAC em `a1_wa_coexy` (só a chave de serviço lê).
- O token de cada canal fica em `a1_wa_oficial` (só a chave de serviço lê). O
  navegador nunca vê a chave da Coexy, o token do canal nem o segredo do webhook.

## Regras de envio

| Situação | Sai por |
|---|---|
| Lead escreveu nas últimas 24 h (texto, arquivo) | oficial |
| Modelo aprovado (qualquer hora) | oficial |
| Texto livre fora da janela de 24 h | Evolution, se a reserva estiver ligada e conectada; senão a tela pede um modelo |
| Oficial recusou por canal (fora do ar, token, pagamento, limite da Meta) | Evolution, se houver reserva |
| Número sem WhatsApp, modelo inválido, marketing segurado pela Meta | não vai para a reserva |
| Cliente sem oficial ativo | Evolution, com os limites anti-bloqueio de sempre |

"Reserva automática" desligada só vale com o oficial ativo. Os limites anti-bloqueio
(`limites.mjs`) contam só a Evolution.

## Segredos (Supabase › Edge Functions › Secrets)

| Nome | O quê |
|---|---|
| `COEXY_API_KEY` | Chave da conta Coexy da plataforma (`crt_pk_...`). Painel Coexy › API Keys › Nova chave. Copiar direto para o Supabase; não colar em chat nem em arquivo. |
| `COEXY_HMAC_SECRET` | Opcional. Só se o webhook for criado à mão no painel da Coexy. Sem ele, vale o segredo que o SIIMOB guardou ao criar o webhook. |

## Publicação

1. Banco: `database/migrations/2026-11-26_whatsapp_oficial.sql` (idempotente).
2. Funções: `atendimento-conectores`, `elia` e `coexy-webhook` (esta com verify_jwt
   desligado: quem chama é a Coexy; a autenticação é a assinatura HMAC).
3. Segredo `COEXY_API_KEY`.
4. Tela.

O webhook é criado sozinho na primeira vez que um gestor clica em "Conectar
WhatsApp oficial". Eventos assinados: `messages`, `smb_message_echoes`,
`channel_status_update`, `channel_health_update`, `message_template_status_update`
(formato `meta`).

## Modelos de mensagem

Cada número tem a própria conta WhatsApp Business: os modelos são criados no cartão
do oficial (Integrações), vão para a revisão da Meta e aparecem na Central ("Enviar
modelo") e nas campanhas da ELIA quando aprovados. O SIIMOB manda modelos com
variáveis numeradas no texto ({{1}}, {{2}}...), cabeçalho de texto fixo, rodapé e
botões sem variável. Modelos com mídia no cabeçalho ou variáveis nomeadas aparecem
como "só pelo WhatsApp Manager".

## Saúde do número

A Coexy avisa (`channel_health_update`) e o cartão mostra: Atenção, Restrito,
Bloqueado ou Banido, com o motivo da Meta. Ex.: "Pagamento recusado na Meta" bloqueia
as conversas iniciadas pela empresa (modelos) até a forma de pagamento da conta
WhatsApp Business ser regularizada no Gerenciador de Negócios da Meta.
