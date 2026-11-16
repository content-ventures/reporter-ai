'use client';
import { useState } from 'react';
import { useEditorState } from '@tiptap/react';
import { Button, Field, Input, List, ListItem, PageStack, Section, TextLink, toast } from '@content-ventures/design-system/v3';
import { articleClipboard } from '@/domain/text/article-clipboard';
import { publicationMetadata, publicationReview, readPublicationMetadata, type PublicationMetadata } from '@/domain/publication';
import { useStudio } from './studio-context';
export function PublicationPane() {
  const studio = useStudio();
  const body = { ...studio.body, title: studio.title };
  const [draft, setDraft] = useState<PublicationMetadata | null>(null);
  const saved = useEditorState({ editor: studio.editor, selector: ({ editor }) => readPublicationMetadata(editor?.state.doc.attrs.seo) });
  const metadata = draft ?? saved ?? body.seo ?? publicationMetadata(body, studio.production.brief.editorial);
  const fields: { key: keyof PublicationMetadata; label: string }[] = [
    { key: 'title', label: 'Título para busca' }, { key: 'description', label: 'Meta description' },
    { key: 'standfirst', label: 'Linha fina' }, { key: 'slug', label: 'Slug' },
    { key: 'keyword', label: 'Palavra-chave principal' }, { key: 'secondaryKeywords', label: 'Palavras-chave secundárias' }, { key: 'searchIntent', label: 'Intenção de busca' },
  ];
  const review = publicationReview(body, metadata);
  const locked = !studio.canEdit || studio.readOnly || studio.generation.active || Boolean(studio.refusal);
  return <PageStack><Section title="SEO e publicação" titleAs="h3">
    {fields.map(({ key, label }) => <Field key={key} label={label}>{({ id }) => <Input id={id} value={metadata[key]} maxLength={key === 'standfirst' ? 240 : key === 'slug' ? 180 : 2000} disabled={locked} onChange={e => setDraft({ ...metadata, [key]: e.target.value })} />}</Field>)}
    <List label="Conferência editorial" framed={false}>
      <ListItem title="Meta description" trailing={`${review.descriptionChars} caracteres`} />
      <ListItem title="Palavra-chave no título" trailing={review.keywordInTitle === null ? 'Definir palavra-chave' : review.keywordInTitle ? 'Presente' : 'Conferir título'} />
      <ListItem title="Slug" trailing={review.validSlug ? 'Legível' : 'Revisar'} />
      <ListItem title="Parágrafos com mais de 150 palavras" trailing={String(review.longParagraphs)} />
    </List>
    <Button disabled={locked || !draft} onClick={() => {
      const editor = studio.editor;
      if (!editor || !draft) return;
      editor.view.dispatch(editor.state.tr.setDocAttribute('seo', draft));
      studio.handle.flush();
      if (draft.standfirst !== studio.dek) studio.commitDek(draft.standfirst);
      setDraft(null); toast('Metadados atualizados');
    }}>Salvar metadados</Button>
    <Button variant="ghost" disabled={locked} onClick={() => setDraft(publicationMetadata(body, studio.production.brief.editorial))}>Sugerir a partir do texto atual</Button>
    <Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(fields.map(f => `${f.label}: ${metadata[f.key]}`).join('\n')); toast('Pacote SEO copiado'); } catch { toast('Não foi possível copiar', { tone: 'error' }); } }}>Copiar pacote SEO</Button>
    <Button variant="ghost" onClick={async () => {
      try {
        const current = studio.handle.getBody() ?? body;
        const content = articleClipboard({ ...current, title: studio.title, ...(studio.dek ? { dek: studio.dek } : {}) });
        if (typeof ClipboardItem !== 'undefined') await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([content.html], { type: 'text/html' }), 'text/plain': new Blob([content.text], { type: 'text/plain' }) })]);
        else await navigator.clipboard.writeText(content.text);
        toast('Texto copiado para o publicador');
      } catch { toast('Não foi possível copiar', { tone: 'error' }); }
    }}>Copiar texto para WordPress</Button>
    <TextLink href="https://www.semrush.com/analytics/keywordoverview/" target="_blank" rel="noopener noreferrer">Validar palavras-chave no Semrush</TextLink>
  </Section></PageStack>;
}
