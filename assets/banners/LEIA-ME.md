# Banners do Mural de Avisos

Arte pronta para usar no **Mural de Avisos** (superadmin → Mural de Avisos).

## IndicaSII

| Arquivo | Uso |
|---|---|
| `indicasii-mural.jpg` | **É este que vai no mural.** 2400×1260, 192 KB — leve, porque o popup abre em todo login. |
| `indicasii-mural.png` | Mesma arte sem compressão (1,2 MB). Para impressão, slide ou post. |
| `indicasii-mural.html` | O código-fonte da arte. É daqui que os PNG/JPG saem. |
| `indicasii-mural-texto.txt` | O texto do aviso, para colar no campo "Corpo". |

Como o arquivo está no repositório, ele também fica no ar depois do deploy:

    https://siimob.com.br/assets/banners/indicasii-mural.jpg

Dá para colar essa URL direto no campo de imagem do aviso, sem precisar subir
arquivo nenhum para o Storage.

## Como gerar de novo (se mudar o texto ou o percentual)

A arte é uma página HTML fotografada pelo navegador — 1200×630 em escala 2×,
o que dá 2400×1260. Precisa da fonte Inter instalada no sistema.

```js
// render.js
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport:{width:1200,height:630}, deviceScaleFactor:2 });
  await p.goto('file:///caminho/para/indicasii-mural.html');
  await p.waitForTimeout(500);
  await p.screenshot({ path:'indicasii-mural.jpg', type:'jpeg', quality:92 });
  await p.screenshot({ path:'indicasii-mural.png' });
  await b.close();
})();
```

**Regra de ouro do tamanho da letra:** dentro do popup do mural a imagem entra
com cerca de 510 px de largura, ou seja, 42% do tamanho original. Texto menor
que 26 px na arte vira letra de bula na tela do usuário. Por isso o banner tem
poucos elementos e todos grandes — o detalhe fica no corpo do aviso, não na
imagem.
