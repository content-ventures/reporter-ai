import 'server-only';
import sharp from 'sharp';
import { z } from 'zod';
import { BANNER_FORMATS, BANNER_PALETTES, type BannerContent } from '../domain/visual-library';
import { FlowError } from './errors';

const line = (max: number) => z.string().trim().max(max).refine(value => !/[\x00-\x1f\x7f]/.test(value));
export const bannerSchema = z.object({ template: z.enum(['photo','editorial','quote']),format: z.enum(['portrait','square','story','landscape']),
  palette: z.enum(['ocean','ink']),brand: line(40).min(1),kicker: line(50),title: line(150).min(1),description: line(240),cta: line(50),
  imageId: z.string().uuid().optional(),productionId: z.string().uuid().optional(),quote: line(200).optional(),quoteCredit: line(80).optional() }).strict();
export function escapeXml(value: string) { return value.replace(/[&<>"']/g,c => ({ '&': '&amp;','<': '&lt;','>': '&gt;','"': '&quot;',"'": '&apos;' }[c]!)); }
/** Conservative text measurement. Overlong copy is refused, never silently cropped or elided. */
export function wrapBannerText(value: string,width: number,size: number): string[] {
  const rows: string[] = []; let row = '';
  const measure = (text: string) => [...text].reduce((sum,c) => sum+(/[MW@%]/.test(c) ? .91 : /[ilI.,' !]/.test(c) ? .31 : .62)*size,0);
  for (const word of value.split(/\s+/).filter(Boolean)) {
    if (measure(word) > width) throw new FlowError('BANNER_TEXT_OVERFLOW',422);
    const next = row ? `${row} ${word}` : word;
    if (row && measure(next) > width) { rows.push(row); row = word; } else row = next;
  }
  if (row) rows.push(row);
  return rows;
}
type BannerPhoto = { bytes: Buffer; attribution: string; sourceUrl?: string; licenseUrl?: string; creditRequired?: boolean };
export function bannerSvg(input: BannerContent,photo?: BannerPhoto): string {
  const content = bannerSchema.parse(input),{ width: w,height: h } = BANNER_FORMATS[content.format],palette = BANNER_PALETTES[content.palette];
  if (content.template === 'photo' && !photo) throw new FlowError('BANNER_IMAGE_REQUIRED',422);
  if (content.template === 'quote' && (!content.quote?.trim() || !content.quoteCredit?.trim())) throw new FlowError('BANNER_QUOTE_REQUIRED',422);
  const wide = w > h, m = wide ? 54 : 72;
  const footer = content.format === 'story' ? 310 : 160;
  const photoHeight = wide ? h-footer : Math.round(h*.43),textY = content.template === 'photo' && !wide ? photoHeight+64 : wide ? 175 : 240;
  const textWidth = (wide && content.template === 'photo' ? 620 : w-m*2)-(content.template === 'editorial' ? 56 : 0);
  const bottom = h-footer-50, available = bottom-textY-(content.description ? (wide ? 90 : 180) : content.template === 'quote' ? 100 : 0);
  const title = content.template === 'quote' ? `“${content.quote}”` : content.title;
  let size = wide ? 60 : content.template === 'quote' ? 68 : 88;
  let rows = wrapBannerText(title,textWidth,size);
  while (rows.length*size*1.12 > available && size > (wide ? 36 : 48)) { size -= 2; rows = wrapBannerText(title,textWidth,size); }
  if (rows.length*size*1.12 > available) throw new FlowError('BANNER_TEXT_OVERFLOW',422);
  const text = (value: string,x: number,y: number,fontSize: number,color: string,weight = 400,family = 'Arial, Helvetica, sans-serif') =>
    `<text x="${x}" y="${y}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" fill="${color}">${escapeXml(value)}</text>`;
  for (const [value,fontSize,width] of [[content.brand,wide ? 26 : 32,w-m*2],[content.kicker.toLocaleUpperCase('pt-BR'),wide ? 17 : 23,textWidth-24],[content.cta,wide ? 21 : 28,w-m*2]] as const) {
    if (wrapBannerText(value,width,fontSize).length > 1) throw new FlowError('BANNER_TEXT_OVERFLOW',422);
  }
  const elements: string[] = [`<rect width="${w}" height="${h}" fill="${palette.paper}"/>`];
  if (photo && content.template === 'photo') {
    const x = wide ? 740 : 0,photoWidth = wide ? w-x : w;
    elements.push(`<image x="${x}" y="0" width="${photoWidth}" height="${photoHeight}" preserveAspectRatio="xMidYMid slice" href="data:image/jpeg;base64,${photo.bytes.toString('base64')}"/>`);
    elements.push(`<rect x="${x}" y="0" width="${photoWidth}" height="${content.format === 'story' ? 264 : 110}" fill="${palette.ink}" fill-opacity="0.8"/>`);
  }
  if (content.template === 'editorial') elements.push(`<rect x="${w-m-24}" y="${wide ? 90 : 180}" width="24" height="${h-(wide ? 180 : 360)}" fill="${palette.ink}"/>`);
  const headerColor = content.template === 'photo' && !wide ? palette.paper : palette.ink;
  elements.push(text(content.brand,m,content.format === 'story' ? 230 : wide ? 66 : 76,wide ? 26 : 32,headerColor,700));
  const kickerY = content.template === 'photo' && !wide ? textY-22 : wide ? 122 : 172;
  elements.push(`<rect x="${m}" y="${kickerY-25}" width="${Math.min(textWidth,content.kicker.length*17+30)}" height="36" fill="${palette.accent}"/>`,text(content.kicker.toLocaleUpperCase('pt-BR'),m+12,kickerY,wide ? 17 : 23,palette.ink,700));
  rows.forEach((row,i) => elements.push(text(row,m,textY+size+i*size*1.12,size,palette.ink,700,content.template === 'quote' ? 'Georgia, serif' : undefined)));
  let after = textY+rows.length*size*1.12+48;
  const description = content.template === 'quote' ? content.quoteCredit! : content.description;
  const descRows = wrapBannerText(description,textWidth,wide ? 22 : 30);
  if (after+descRows.length*(wide ? 30 : 42) > h-footer) throw new FlowError('BANNER_TEXT_OVERFLOW',422);
  descRows.forEach(row => { elements.push(text(row,m,after,wide ? 22 : 30,palette.ink)); after += wide ? 30 : 42; });
  elements.push(`<line x1="${m}" y1="${h-footer+10}" x2="${w-m}" y2="${h-footer+10}" stroke="${palette.ink}" stroke-width="2"/>`,text(content.cta,m,h-footer+55,wide ? 21 : 28,palette.ink,700));
  if (photo) {
    if (photo.creditRequired !== false) {
      const credit = photo.attribution+' · recorte editorial'+(photo.licenseUrl ? ` · ${photo.licenseUrl}` : '');
      const credits = wrapBannerText(credit,w-m*2,wide ? 11 : 14);
      if (credits.length > 4) throw new FlowError('BANNER_CREDIT_OVERFLOW',422);
      credits.forEach((row,i) => elements.push(text(row,m,h-footer+82+i*17,wide ? 11 : 14,palette.ink)));
    }
    elements.push(`<metadata>${escapeXml(JSON.stringify({ attribution: photo.attribution,licenseUrl: photo.licenseUrl,sourceUrl: photo.sourceUrl,modification: 'Recorte editorial' }))}</metadata>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${elements.join('')}</svg>`;
}
export async function renderBanner(content: BannerContent,photo?: BannerPhoto) {
  const svg = bannerSvg(content,photo);
  return { svg,png: await sharp(Buffer.from(svg),{ limitInputPixels: 4000000 }).png().toBuffer() };
}
