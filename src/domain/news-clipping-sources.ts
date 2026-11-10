/** Publisher domains from the newsroom matrix. These are search preferences, not feed URLs. */
const sourceMatrix = {
  specialized: 'seafoodsource.com europa-azul.es undercurrentnews.com br.thefishsite.com aquaculturebrasil.com.br panoramadaaquicultura.com.br revistapuerto.com.ar salmonbusiness.com salmonexpert.cl seafoodnews.com mundoacuicola.cl aquafeed.com iffo.com fiskerforum.com weareaquaculture.com mispeces.com pescaymedioambiente.com efeedlink.com minato-yamaguchi.co.jp agripesca.it aquaculturemag.com aqua.cl pesceinrete.com aquaasiapac.com suikei.co.jp ipacuicultura.com fishfocus.co.uk feap.info foodnavigator.com euromeatnews.com feedfood.com.br feedandadditive.com feedstrategy.com',
  associations: 'peixebr.com.br abipesca.com.br conepe.org.br sindipi.com.br abccam.com.br abrapes.org feap.info iffo.com',
  retail: 'abras.com.br gironews.com superhiper.com.br mercadoeconsumo.com.br ecommercebrasil.com.br',
  foodService: 'anrbrasil.org.br abrasel.com.br foodserviceequipmentjournal.com abia.org.br abf.com.br foodconnection.com.br anuga-brazil.com.br forbes.com.br foodnews.com.br foodtalkbrasil.com.br redefoodservice.com.br galunion.com.br gironews.com',
  generalAndOfficial: 'g1.com.br cnn.com.br br.reuters.com agenciabrasil.ebc.com.br bbc.com uol.com.br valor.globo.com infomoney.com.br valorinveste.globo.com exame.com br.advfn.com canalrural.com.br noticiasagricolas.com.br gov.br pesca.sp.gov.br embrapa.br epagri.sc.gov.br ceagesp.gov.br ibge.gov.br portaldaindustria.com.br sebrae.com.br beefpoint.com.br',
} as const;

export const CLIPPING_PRIORITY_DOMAINS = [...new Set([...Object.values(sourceMatrix).flatMap(group => group.split(' ')),
  'g1.globo.com', 'cnnbrasil.com.br', 'in.gov.br', 'fao.org', 'anvisa.gov.br', 'ibama.gov.br'])];
