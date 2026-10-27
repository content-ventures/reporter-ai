import {AccessState,ButtonLink} from '@content-ventures/design-system/v3';

/** Explicit context refusals recover through a manual choice without loading the pilot. */
export default function WorkspaceUnavailable(){
  return <AccessState kind="not-found" heading="h1" title="Workspace indisponível" actions={<ButtonLink href="/workspaces?unavailable=1" variant="primary">Escolher workspace</ButtonLink>}/>;
}
