'use client';

import { useMemo } from 'react';
import { Card, CardHeader, CardLink, Grid, Panel, Section, SkeletonText, TextLink } from '@content-ventures/design-system/v3';
import { usePhone } from '@/ui/use-phone';
import { useRuntime } from '@/state';
import { TemplateThumb } from '@/features/library/template-card';

/** Reuses the library renderer and opens its existing model preview. */
export function TemplateStrip() {
  const phone = usePhone();
  const { runtime } = useRuntime();
  const templates = useMemo(() => {
    const available = runtime?.render.templates() ?? [];
    const firstFormat = available[0]?.format;
    return available.filter(template => template.format === firstFormat).slice(0, phone ? 2 : 3);
  }, [runtime, phone]);
  if (runtime && !templates.length) return null;
  return <Panel><Section title="Modelos para seu próximo carrossel" action={<TextLink href="/library/templates" size="sm">Ver modelos</TextLink>}>
    {!runtime ? <SkeletonText lines={3} /> : <Grid columns={phone ? '1:1' : '1:1:1'} collapseBelow={false} gap="sm" label="Modelos de carrossel">
      {templates.map(template => <Card key={template.id} padding="sm" interactive>
        <TemplateThumb template={template} cover={{ articleCover: template.previewPhoto ?? runtime.render.samplePhoto }} />
        <CardHeader titleAs="h3" title={<CardLink href={`/library/templates?model=${encodeURIComponent(template.id)}`}>{template.name}</CardLink>} />
      </Card>)}
    </Grid>}
  </Section></Panel>;
}
