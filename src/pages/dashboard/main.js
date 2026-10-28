    // Pré-análise, Venda e Repasse usam o painel unificado. O parâmetro vem
    // do shell, que já decidiu o primeiro painel permitido para o perfil.
    const slug = (function() {
      const m = location.pathname.match(/^\/([^/]+)/);
      return m ? m[1] : null;
    })();
    const painel = new URLSearchParams(location.search).get('painel');
    if (slug) location.replace('/' + slug + '/repasse' + (painel ? '?painel=' + encodeURIComponent(painel) : ''));
    else location.replace('/');
  
