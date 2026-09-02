#!/usr/bin/env python3
# Gera a planilha de exemplo do importador. Ela precisa VIVER NO REPOSITÓRIO:
# a suíte dependia do arquivo que o cliente enviou uma vez, guardado fora do
# projeto — no dia em que aquela pasta sumiu, o teste passou a falhar por falta
# de arquivo, e na CI nunca teria funcionado.
#
# As 11 colunas são as mesmas da base real do cliente, com dados inventados,
# de propósito: nenhum nome ou CPF de pessoa real entra no repositório.
import zipfile, io, os

COLUNAS = ['DATA DA VENDA','ANALISTA','CIDADE','CONSTRUTORA','MODALIDADE','CORRETOR',
           'COORDENADOR','CLIENTE','CPF','AGENCIA','STATUS']

LINHAS = [
  ['15/07/2026','AMANDA DA SILVA RODRIGUES','TERESINA','CANOPUS','SBPE','CARLOS PEREIRA DE SOUSA',
   'MARCELO RICARDO','CLIENTE EXEMPLO UM','529.982.247-25','0855 - JOQUEI','A ENVIAR CONFORMIDADE'],
  ['22/07/2026','GILBERTO FERREIRA','TIMON','TERRAS CONSTRUTORA','MCMV','ANA LUCIA MARTINS',
   'RAYRES SOUSA','CLIENTE EXEMPLO DOIS','111.444.777-35','1234 - CENTRO','AGUARDANDO CONFORMIDADE'],
  ['03/08/2026','TEYCIVANNE RIBEIRO DE OLIVEIRA','ALTOS','MONTANA','FGTS','CARLOS PEREIRA DE SOUSA',
   'MARCELO RICARDO','CLIENTE EXEMPLO TRES','529.982.247-25','0855 - JOQUEI','AGUARDANDO LAUDO'],
  ['','JANAILSON DE OLIVEIRA ARAUJO','DEMERVAL','COESA','SBPE','JOAO BATISTA LIMA',
   '','CLIENTE EXEMPLO QUATRO','111.444.777-35','','PENDENTE'],
  ['11/08/2026','ANALISTA QUE NAO EXISTE','TERESINA','CONSTRUTORA NOVA','SBPE','ANA LUCIA MARTINS',
   'RAYRES SOUSA','CLIENTE EXEMPLO CINCO','529.982.247-25','1234 - CENTRO','ETAPA DESCONHECIDA'],
]

def col(i):
    s = ''
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s

def esc(t):
    return (str(t).replace('&','&amp;').replace('<','&lt;').replace('>','&gt;'))

textos, indice = [], {}
def idx(t):
    if t not in indice:
        indice[t] = len(textos); textos.append(t)
    return indice[t]

linhas_xml = []
for n, linha in enumerate([COLUNAS] + LINHAS, start=1):
    celulas = ''.join(
        '<c r="%s%d" t="s"><v>%d</v></c>' % (col(j), n, idx(v))
        for j, v in enumerate(linha) if str(v) != '')
    linhas_xml.append('<row r="%d">%s</row>' % (n, celulas))

sheet = ('<?xml version="1.0" encoding="UTF-8"?>'
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  '<sheetData>%s</sheetData></worksheet>' % ''.join(linhas_xml))

shared = ('<?xml version="1.0" encoding="UTF-8"?>'
  '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="%d" uniqueCount="%d">%s</sst>'
  % (len(textos), len(textos), ''.join('<si><t>%s</t></si>' % esc(t) for t in textos)))

wb = ('<?xml version="1.0" encoding="UTF-8"?>'
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
  '<sheets><sheet name="Processos" sheetId="1" r:id="rId1"/></sheets></workbook>')

wb_rels = ('<?xml version="1.0" encoding="UTF-8"?>'
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
  '</Relationships>')

rels = ('<?xml version="1.0" encoding="UTF-8"?>'
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
  '</Relationships>')

ct = ('<?xml version="1.0" encoding="UTF-8"?>'
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  '<Default Extension="xml" ContentType="application/xml"/>'
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
  '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
  '</Types>')

destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'base-exemplo.xlsx')
with zipfile.ZipFile(destino, 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', ct)
    z.writestr('_rels/.rels', rels)
    z.writestr('xl/workbook.xml', wb)
    z.writestr('xl/_rels/workbook.xml.rels', wb_rels)
    z.writestr('xl/sharedStrings.xml', shared)
    z.writestr('xl/worksheets/sheet1.xml', sheet)
print('gerado:', destino, os.path.getsize(destino), 'bytes,',
      len(LINHAS), 'linhas x', len(COLUNAS), 'colunas')
