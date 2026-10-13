import 'server-only';
import type { ArticleBody, ArticleBlock } from '../domain/article.ts';
import type { OutlineInput } from '../ports/generation.ts';

/** Read only string values already received, including an unfinished prose string.
 * Incomplete escapes/keys stay buffered. This is NOT a validator or a final JSON repair. */
export function partialJsonStrings(input: string): Map<string,string> {
  const strings = new Map<string,string>(); let at = 0, stopped = false;
  const space = () => { while (/\s/.test(input[at] ?? '') && at < input.length) at++; };
  const string = (): { text: string; complete: boolean } => {
    at++; let text = '';
    while (at < input.length) {
      const char = input[at++];
      if (char === '"') return { text,complete: true };
      if (char !== '\\') { text += char; continue; }
      const escape = input[at++];
      const escaped: Record<string,string> = { '"': '"','\\': '\\','/': '/','b': '\b','f': '\f','n': '\n','r': '\r','t': '\t' };
      if (escape === 'u') {
        const hex = input.slice(at,at+4);
        if (!/^[a-f\d]{4}$/i.test(hex)) break;
        text += String.fromCharCode(parseInt(hex,16)); at += 4;
      } else if (escape in escaped) text += escaped[escape];
      else break;
    }
    // Do not render half of a surrogate pair on a transport boundary.
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0,-1);
    stopped = true; return { text,complete: false };
  };
  const value = (path: string[],depth: number) => {
    if (stopped || depth > 16) { stopped = true; return; }
    space(); const char = input[at];
    if (char === '"') { const result = string(); strings.set(path.join('.'),result.text); return; }
    if (char === '{') {
      at++; space();
      while (input[at] !== '}' && !stopped) {
        if (input[at] !== '"') { stopped = true; return; }
        const key = string(); if (!key.complete) return;
        space(); if (input[at++] !== ':') { stopped = true; return; }
        value([...path,key.text],depth+1); space();
        if (input[at] === ',') { at++; space(); } else if (input[at] !== '}') { stopped = true; return; }
      }
      at++; return;
    }
    if (char === '[') {
      at++; space(); let index = 0;
      while (input[at] !== ']' && !stopped) {
        value([...path,String(index++)],depth+1); space();
        if (input[at] === ',') { at++; space(); } else if (input[at] !== ']') { stopped = true; return; }
      }
      at++; return;
    }
    // Numeric/null/boolean fields cannot become article prose.
    const atom = /^(?:null|true|false|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(input.slice(at));
    if (atom) at += atom[0].length; else stopped = true;
  };
  value([],0); return strings;
}

/** Fixed reviewed headings, literal received prose, stable preview ids. No evidence claims. */
export function articlePreview(runId: string,outline: OutlineInput,headings: boolean,stages: ReadonlyMap<string,string>): ArticleBody {
  const single = stages.has('article') ? partialJsonStrings(stages.get('article')!) : undefined;
  const blocks: ArticleBlock[] = [];
  const append = (values: Map<string,string>,prefix: string,part: string,maximum: number) => {
    for (let i=0; i<maximum; i++) {
      const text = values.get(`${prefix}.${i}.text`);
      if (text) blocks.push({ id: `${runId}:preview:${part}:${i}`,type: 'paragraph',inlines: [{ text }],ai: 'unreviewed' });
    }
  };
  append(single ?? partialJsonStrings(stages.get('intro') ?? ''),single ? 'intro' : 'paragraphs','intro',3);
  outline.sections.forEach((section,index) => {
    const values = single ?? partialJsonStrings(stages.get('section-'+index) ?? '');
    const prefix = single ? `sections.${index}.paragraphs` : 'paragraphs';
    if (!values.get(prefix+'.0.text')) return;
    if (headings) blocks.push({ id: `${runId}:preview:heading:${index}`,type: 'heading',level: 2,inlines: [{ text: section.title }],ai: 'unreviewed' });
    append(values,prefix,'section-'+index,10);
  });
  return { type: 'article',title: outline.title,blocks };
}
