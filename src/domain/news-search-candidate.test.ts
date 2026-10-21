import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isNewsSearchCandidate } from './news-search-candidate.ts';
import type { NewsSearchConfig } from './news-search.ts';

const config: NewsSearchConfig = { portalUrl: 'https://client.example', sector: 'Pesca e aquicultura', region: '',
  topics: ['produção e exportação de pescado'], languages: ['pt', 'en', 'es'], excludedDomains: [], everyMinutes: 60, dailyLimit: 4, enabled: true };
test('dated institutional indexes, papers and unrelated reports never enter the news radar', () => {
  for (const [url, title] of [
    ['https://www.gov.br/agricultura/pt-br', 'Home — Ministério da Agricultura e Pecuária'],
    ['https://www.gub.uy/ministerio-ganaderia-agricultura-pesca', 'Ministerio de Ganadería Agricultura Pesca'],
    ['https://report.example/report.pdf', 'Relatório anual do pescado'],
    ['https://www.researchgate.net/publication/123', 'Desigualdades Regionais no Emprego em Portugal'],
    ['https://angola.org/es/noticias/mensagem', 'Mensagem sobre o Estado da Nação 2026'],
    ['https://rtc.cv/rcv/audio-details/123', 'Presidente da Câmara de Comércio de Sotavento'],
    ['https://publisher.example/category/fisheries', 'Fisheries news and reports'],
  ]) assert.equal(isNewsSearchCandidate(config, { url, title }), false, title);
});
test('relevant international headlines remain eligible without relying on incidental body mentions', () => {
  for (const title of ['Governo avança para retomar exportação de pescado à UE', 'Escola produz uma tonelada de tilápia',
    'Confira o que muda no licenciamento ambiental da aquicultura', 'Norwegian salmon exports rise in October',
    'Camarón ecuatoriano crece en el mercado mundial']) {
    assert.equal(isNewsSearchCandidate(config, { url: 'https://publisher.example/news/123', title, score: 0.8 }), true, title);
    assert.equal(isNewsSearchCandidate(config, { url: 'https://publisher.example/news/123', title, score: 0.2 }), false);
  }
  assert.equal(isNewsSearchCandidate({ ...config, sector: 'Tecnologia', topics: ['inteligência artificial'] },
    { url: 'https://publisher.example/news/123', title: 'Inteligência artificial ganha novas aplicações' }), true);
});
