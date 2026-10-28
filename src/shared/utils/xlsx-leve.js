// ─── Leitor de planilha, sem biblioteca externa ──────────────────────────────
// Um .xlsx é um zip com XML dentro. O navegador já sabe descompactar
// (DecompressionStream) e já sabe ler XML (DOMParser), então dá para ler o
// arquivo sem trazer nenhuma biblioteca de fora — nada de CDN, nada de peso a
// mais nas páginas, e um arquivo do cliente nunca sai do navegador dele.
//
// Lê também .csv, que é o que sai quando alguém exporta de outro sistema.

const XLSX = (() => {

  // ── zip ────────────────────────────────────────────────────────────────────
  // Procura o fim do diretório central (assinatura PK\x05\x06) a partir do fim
  // do arquivo — é ali que ficam os ponteiros para cada arquivo de dentro.
  function lerZip(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= 0 && i > buf.byteLength - 66000; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Arquivo não parece um .xlsx (não achei o índice do zip).');

    const total = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const itens = {};
    for (let i = 0; i < total; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const metodo   = dv.getUint16(p + 10, true);
      const tamComp  = dv.getUint32(p + 20, true);
      const nLen     = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const comLen   = dv.getUint16(p + 32, true);
      const desloc   = dv.getUint32(p + 42, true);
      const nome     = new TextDecoder().decode(new Uint8Array(buf, p + 46, nLen));
      itens[nome] = { metodo, tamComp, desloc };
      p += 46 + nLen + extraLen + comLen;
    }
    return { dv, buf, itens };
  }

  async function extrair(zip, nome) {
    const it = zip.itens[nome];
    if (!it) return null;
    // O cabeçalho local repete o tamanho dos campos variáveis; é dali que sai
    // a posição real dos bytes.
    const nLen     = zip.dv.getUint16(it.desloc + 26, true);
    const extraLen = zip.dv.getUint16(it.desloc + 28, true);
    const ini      = it.desloc + 30 + nLen + extraLen;
    const bytes    = new Uint8Array(zip.buf, ini, it.tamComp);
    if (it.metodo === 0) return new TextDecoder().decode(bytes);           // sem compactar
    if (it.metodo !== 8) throw new Error('Compactação do zip não suportada (método ' + it.metodo + ').');
    const fluxo = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new TextDecoder().decode(await new Response(fluxo).arrayBuffer());
  }

  // ── planilha ───────────────────────────────────────────────────────────────
  const colDe = ref => (ref.match(/^[A-Z]+/) || [''])[0];
  const colNum = letras => [...letras].reduce((a, c) => a * 26 + (c.charCodeAt(0) - 64), 0);
  const numCol = n => { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; } return s; };

  // Excel guarda data como número de dias desde 30/12/1899.
  function serialParaData(n) {
    const ms = Math.round((n - 25569) * 86400000);
    const d = new Date(ms);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }

  async function lerXlsx(arquivo) {
    const zip = lerZip(await arquivo.arrayBuffer());

    // Textos repetidos ficam numa tabela à parte, referenciados por índice.
    const compart = [];
    const ssXml = await extrair(zip, 'xl/sharedStrings.xml');
    if (ssXml) {
      const doc = new DOMParser().parseFromString(ssXml, 'application/xml');
      for (const si of doc.getElementsByTagName('si')) {
        let txt = '';
        for (const tn of si.getElementsByTagName('t')) txt += tn.textContent || '';
        compart.push(txt);
      }
    }

    // Quais estilos são de data — é o que diferencia 45867 de "45867".
    const ehData = {};
    const stXml = await extrair(zip, 'xl/styles.xml');
    if (stXml) {
      const doc = new DOMParser().parseFromString(stXml, 'application/xml');
      const formatos = {};
      for (const f of doc.getElementsByTagName('numFmt')) {
        formatos[f.getAttribute('numFmtId')] = f.getAttribute('formatCode') || '';
      }
      const xfs = doc.querySelector('cellXfs');
      if (xfs) [...xfs.getElementsByTagName('xf')].forEach((xf, i) => {
        const id = xf.getAttribute('numFmtId') || '0';
        const cod = formatos[id] || '';
        // 14–22 e 45–47 são os formatos de data/hora embutidos do Excel.
        const n = parseInt(id, 10);
        ehData[i] = (n >= 14 && n <= 22) || (n >= 45 && n <= 47) || /[dmyhs]/i.test(cod) && !/[#0]/.test(cod);
      });
    }

    // A primeira aba que existir.
    let folhaXml = null;
    for (const nome of Object.keys(zip.itens)) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(nome)) { folhaXml = await extrair(zip, nome); break; }
    }
    if (!folhaXml) throw new Error('Não encontrei nenhuma aba dentro do arquivo.');

    const doc = new DOMParser().parseFromString(folhaXml, 'application/xml');
    const linhas = [];
    for (const row of doc.getElementsByTagName('row')) {
      const linha = {};
      for (const c of row.getElementsByTagName('c')) {
        const ref = c.getAttribute('r') || '';
        const col = colDe(ref);
        const tipo = c.getAttribute('t');
        const estilo = parseInt(c.getAttribute('s') || '0', 10);
        const vn = c.getElementsByTagName('v')[0];
        let valor = '';
        if (tipo === 's' && vn) valor = compart[parseInt(vn.textContent, 10)] || '';
        else if (tipo === 'inlineStr') {
          const is = c.getElementsByTagName('is')[0];
          if (is) for (const tn of is.getElementsByTagName('t')) valor += tn.textContent || '';
        } else if (vn) {
          valor = vn.textContent || '';
          if (ehData[estilo] && /^\d+(\.\d+)?$/.test(valor)) {
            const d = serialParaData(parseFloat(valor));
            if (d) valor = d;
          }
        }
        linha[col] = String(valor).trim();
      }
      linhas.push(linha);
    }
    return linhas;
  }

  // ── csv ────────────────────────────────────────────────────────────────────
  function lerCsvTexto(txt) {
    // Separador: o que aparecer mais na primeira linha, entre ; e ,
    const prim = txt.split(/\r?\n/)[0] || '';
    const sep = (prim.split(';').length > prim.split(',').length) ? ';' : ',';
    const linhas = [];
    let campo = '', linha = [], entreAspas = false;
    for (let i = 0; i < txt.length; i++) {
      const c = txt[i];
      if (entreAspas) {
        if (c === '"' && txt[i + 1] === '"') { campo += '"'; i++; }
        else if (c === '"') entreAspas = false;
        else campo += c;
      } else if (c === '"') entreAspas = true;
      else if (c === sep) { linha.push(campo); campo = ''; }
      else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
      else if (c !== '\r') campo += c;
    }
    if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
    return linhas.map(cols => {
      const o = {};
      cols.forEach((v, i) => { o[numCol(i + 1)] = String(v).trim(); });
      return o;
    });
  }

  async function ler(arquivo) {
    if (/\.csv$/i.test(arquivo.name)) return lerCsvTexto(await arquivo.text());
    return lerXlsx(arquivo);
  }

  return { ler, numCol, colNum, serialParaData };
})();
