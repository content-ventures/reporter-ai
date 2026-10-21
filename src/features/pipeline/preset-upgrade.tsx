'use client';

import { useMemo, useState } from 'react';
import { Accordion, Alert, Button, DiffView, Drawer, LinkButton, List, ListItem, PageStack, Panel, Section } from '@content-ventures/design-system/v3';
import type { PipelineDefinition } from '@/domain/pipeline';
import { PROMPTS } from './pipeline-catalog';
import { presetUpgradeView } from './preset-upgrade-model';

const TITLE = 'Prompts padrão 3.0';

function summary(changed: number, kept: number) {
  const moved = changed === 1 ? '1 prompt no padrão anterior passa para o 3.0' : `${changed} prompts no padrão anterior passam para o 3.0`;
  const custom = kept === 1 ? '; 1 personalizado fica como está' : kept > 1 ? `; ${kept} personalizados ficam como estão` : '';
  return `${moved}${custom}.`;
}

/**
 * Offers this build's preset over the active revision. Applying it saves a new revision through
 * the page's own save (the previous one stays in Histórico); nothing changes a revision in place.
 */
export function PresetUpgrade({ active, blocked, saving, error, onApply }: {
  active: PipelineDefinition; blocked: boolean; saving: boolean; error?: string; onApply: () => Promise<boolean>;
}) {
  const view = useMemo(() => presetUpgradeView(active), [active]);
  const [open, setOpen] = useState(false);
  if (!view.changes.length) return null;
  async function apply() {
    if (await onApply()) setOpen(false);
  }
  return <>
    <Alert tone="info" title={TITLE} action={<LinkButton onClick={() => setOpen(true)}>Ver mudanças</LinkButton>}>
      {summary(view.changes.length, view.kept.length)}
    </Alert>
    <Drawer open={open} onClose={() => setOpen(false)} dismissible={!saving} size="lg" title={TITLE} description="Cria uma revisão nova; a atual fica no Histórico."
      footer={<>
        <Button disabled={saving} onClick={() => setOpen(false)}>Cancelar</Button>
        <Button variant="primary" loading={saving} disabled={blocked} onClick={() => void apply()}>Atualizar para 3.0</Button>
      </>}>
      <PageStack>
        {blocked && !saving && <Alert tone="warning" compact>Salve ou descarte as alterações da página antes de atualizar.</Alert>}
        {error && <Alert tone="danger" compact>{error}</Alert>}
        <Accordion items={view.changes.map(change => ({ id: change.key, title: PROMPTS[change.key].title,
          meta: change.added ? 'Nova etapa' : 'Padrão anterior → 3.0',
          content: <DiffView blocks={change.blocks} mode="inline" collapseUnchanged summary={false} size="compact" before={{ label: 'Atual' }} after={{ label: '3.0' }} />,
        }))} />
        {view.kept.length > 0 && <Panel><Section title="Personalizados mantidos">
          <List label="Prompts personalizados" framed={false}>
            {view.kept.map(key => <ListItem key={key} title={PROMPTS[key].title} />)}
          </List>
        </Section></Panel>}
      </PageStack>
    </Drawer>
  </>;
}
