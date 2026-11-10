import type { ClippingLanguage, ClippingSegment } from './news-clipping.ts';

/** Publisher domains from the newsroom matrix and the later IntraFish request. */
const sourceMatrix = {
  specialized: 'seafoodsource.com europa-azul.es undercurrentnews.com intrafish.com br.thefishsite.com aquaculturebrasil.com.br panoramadaaquicultura.com.br revistapuerto.com.ar salmonbusiness.com salmonexpert.cl seafoodnews.com mundoacuicola.cl aquafeed.com iffo.com fiskerforum.com weareaquaculture.com mispeces.com pescaymedioambiente.com efeedlink.com minato-yamaguchi.co.jp agripesca.it aquaculturemag.com aqua.cl pesceinrete.com aquaasiapac.com suikei.co.jp ipacuicultura.com fishfocus.co.uk feap.info foodnavigator.com euromeatnews.com feedfood.com.br feedandadditive.com feedstrategy.com',
  associations: 'peixebr.com.br abipesca.com.br conepe.org.br sindipi.com.br abccam.com.br abrapes.org feap.info iffo.com',
  retail: 'abras.com.br gironews.com superhiper.com.br mercadoeconsumo.com.br ecommercebrasil.com.br',
  foodService: 'anrbrasil.org.br abrasel.com.br foodserviceequipmentjournal.com abia.org.br abf.com.br foodconnection.com.br anuga-brazil.com.br forbes.com.br foodnews.com.br foodtalkbrasil.com.br redefoodservice.com.br galunion.com.br gironews.com',
} as const;

// Open searches prefer the whole matrix. The targeted passes also cover the general
// and official outlets, grouped by the desk where their coverage is most relevant.
const generalAndOfficial: Record<ClippingSegment, string> = {
  aquaculture: 'pesca.sp.gov.br embrapa.br epagri.sc.gov.br canalrural.com.br noticiasagricolas.com.br',
  fishing: 'g1.com.br g1.globo.com agenciabrasil.ebc.com.br',
  industry: 'br.reuters.com valor.globo.com br.advfn.com portaldaindustria.com.br beefpoint.com.br',
  retail: 'uol.com.br valorinveste.globo.com infomoney.com.br exame.com ceagesp.gov.br',
  'food-service': 'cnn.com.br cnnbrasil.com.br sebrae.com.br',
  institutional: 'gov.br in.gov.br bbc.com ibge.gov.br anvisa.gov.br ibama.gov.br fao.org',
};

export const CLIPPING_PRIORITY_DOMAINS = [...new Set([
  ...Object.values(sourceMatrix), ...Object.values(generalAndOfficial),
].flatMap(group => group.split(' ')))];

const aquacultureSources: Record<ClippingLanguage, string> = {
  pt: 'panoramadaaquicultura.com.br aquaculturebrasil.com.br peixebr.com.br feedfood.com.br',
  en: 'fishfocus.co.uk aquafeed.com salmonbusiness.com weareaquaculture.com seafoodsource.com',
  es: 'aqua.cl mundoacuicola.cl salmonexpert.cl',
};

const newsSources: Record<Exclude<ClippingSegment, 'aquaculture'>, string> = {
  fishing: 'seafoodsource.com fiskerforum.com undercurrentnews.com intrafish.com seafoodnews.com fishfocus.co.uk fao.org',
  industry: sourceMatrix.specialized,
  retail: sourceMatrix.retail,
  'food-service': sourceMatrix.foodService,
  institutional: `${sourceMatrix.associations} europa.eu woah.org`,
};

export function clippingNewsDomains(segment: ClippingSegment, language: ClippingLanguage): string[] {
  const sector = segment === 'aquaculture' ? aquacultureSources[language] : newsSources[segment];
  return `${sector} ${generalAndOfficial[segment]}`.split(' ');
}
