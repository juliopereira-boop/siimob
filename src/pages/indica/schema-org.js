import { INDICA } from '../../modules/indica/indica-config.js';
import { $ } from './main.js';
// Schema.org só com o que a página realmente mostra.
$('ld-faq').textContent = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      name: 'SIIMOB',
      url: 'https://siimob.com.br',
      logo: 'https://siimob.com.br/icon-512.png'
    },
    {
      '@type': 'FAQPage',
      mainEntity: INDICA.duvidas.map(d => ({
        '@type': 'Question',
        name: d.p,
        acceptedAnswer: { '@type': 'Answer', text: d.r }
      }))
    }
  ]
});
