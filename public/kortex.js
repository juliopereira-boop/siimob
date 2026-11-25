/* Selo "Um Produto Kortex": fixo no canto inferior direito de todas as páginas.
 * Só visual: não recebe cliques (pointer-events:none), fica acima de telas de
 * login e overlays comuns (z-index 10000), some na impressão e não duplica se
 * o script for incluído duas vezes.
 *
 * BOTAO_CANTO: botão fixo no mesmo canto. Quando ele está visível, o selo vai
 *              para a esquerda dele, alinhado pela base.
 * SOBE:        caixas fixas no canto que devem ficar ACIMA do selo.
 */
(function () {
  var BOTAO_CANTO = ['.zap']; // WhatsApp flutuante do site (siimob.com)
  var SOBE = [];

  if (typeof document === 'undefined' || document.getElementById('kortex-selo')) return;

  function montar() {
    if (document.getElementById('kortex-selo')) return;
    var st = document.createElement('style');
    st.id = 'kortex-selo-estilo';
    st.textContent =
      '#kortex-selo{position:fixed;right:14px;bottom:12px;z-index:10000;pointer-events:none;' +
      'font:400 13.5px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;' +
      'color:#475569;background:rgba(255,255,255,.82);padding:3px 9px;border-radius:999px;' +
      'box-shadow:0 1px 4px rgba(15,23,42,.12);letter-spacing:.01em;white-space:nowrap;' +
      '-webkit-user-select:none;user-select:none}' +
      '#kortex-selo b{font-size:14.5px;font-weight:800;color:#0f172a}' +
      '@media print{#kortex-selo{display:none!important}}';
    document.head.appendChild(st);

    var selo = document.createElement('div');
    selo.id = 'kortex-selo';
    selo.setAttribute('aria-hidden', 'true');
    selo.innerHTML = 'Um Produto <b>Kortex</b>';
    document.body.appendChild(selo);

    function visivel(el) {
      if (!el || el.hidden) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    }
    function primeiro(lista) {
      for (var i = 0; i < lista.length; i++) {
        var achados = document.querySelectorAll(lista[i]);
        for (var j = 0; j < achados.length; j++) if (visivel(achados[j])) return achados[j];
      }
      return null;
    }
    function ajustar() {
      var botao = primeiro(BOTAO_CANTO);
      if (botao) {
        var r = botao.getBoundingClientRect();
        selo.style.right = Math.max(14, Math.round(window.innerWidth - r.left + 10)) + 'px';
        selo.style.bottom = Math.max(12, Math.round(window.innerHeight - r.bottom)) + 'px';
      } else {
        selo.style.right = '14px';
        selo.style.bottom = '12px';
      }
      var altura = selo.getBoundingClientRect().height + 12 + 8;
      for (var i = 0; i < SOBE.length; i++) {
        var caixas = document.querySelectorAll(SOBE[i]);
        for (var j = 0; j < caixas.length; j++) {
          caixas[j].style.bottom = altura + 'px';
        }
      }
    }
    ajustar();
    window.addEventListener('resize', ajustar);
    // O botão do canto pode aparecer depois (o do site só aparece com o número cadastrado).
    setInterval(ajustar, 1500);
  }

  if (document.body) montar();
  else document.addEventListener('DOMContentLoaded', montar, { once: true });
})();
