'use client';

import { useEffect, useRef, useState } from 'react';
import { useWorkspaceRouter as useRouter } from '@/ui/workspace-navigation';
import { ConfirmDialog } from '@content-ventures/design-system/v3';
import { useLeaveGuard } from '@/ui/shell';

/**
 * A setting being edited with unsaved changes: leaving through the app asks first, and a reload
 * or a closed tab gets the browser's own warning. Returns the dialog to render.
 */
export function useEditGuard(active: boolean) {
  const router = useRouter();
  const [exitTo, setExitTo] = useState<string>();
  const departing = useRef(false);
  useLeaveGuard(active, (href) => setExitTo(href));
  useEffect(() => {
    if (!active) return undefined;
    const guard = (event: BeforeUnloadEvent) => {
      if (!departing.current) event.preventDefault();
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [active]);
  return (
    <ConfirmDialog
      open={Boolean(exitTo)}
      onClose={() => setExitTo(undefined)}
      title="Sair sem salvar?"
      description="As mudanças desta versão ainda não foram salvas."
      confirmLabel="Descartar e sair"
      cancelLabel="Continuar editando"
      tone="danger"
      onConfirm={() => {
        departing.current = true;
        const href = exitTo;
        setExitTo(undefined);
        if (href) router.push(href);
      }}
    />
  );
}

/** Focus moves with the mode: into the first control when editing starts, back to "Editar" when it ends. */
export function focusLater(selector: string) {
  requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus());
}
