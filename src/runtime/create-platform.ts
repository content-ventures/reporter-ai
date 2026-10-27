import { createHttpPlatform } from '../adapters/http/platform-client.ts';
import { createDemoPlatform } from '../adapters/local/platform/index.ts';
import { DEMO_OPERATOR_ID, DEMO_WORKSPACE, demoLog, demoPeople, demoUsageFacts } from '../fixtures/platform.ts';
import type { InviteDesk, PlatformConsole } from '../ports/platform.ts';
import type { RuntimeStorage } from './runtime.ts';
import type {WorkspaceAdministration} from '../ports/workspace-management.ts';
import type {MemberViewing} from '../ports/member-view.ts';

/**
 * Composition of the platform console, apart from the workspace runtime: the console never loads
 * the editorial workspace. The demo build keeps people and links in this browser over the seeded
 * history; every other build talks to the server.
 */

export type PlatformRuntime = { console: PlatformConsole; invites: InviteDesk;workspaces?:WorkspaceAdministration;memberViewing?:MemberViewing;dispose?:()=>void };

export type CreatePlatformOptions = {
  demo: boolean;
  storage?: RuntimeStorage | null;
  now?: () => string;
};

export function createPlatformRuntime(options: CreatePlatformOptions): PlatformRuntime {
  if (!options.demo) return createHttpPlatform();
  return createDemoPlatform({
    now: options.now ?? (() => new Date().toISOString()),
    storage: options.storage ?? null,
    seed: (now) => ({ operatorId: DEMO_OPERATOR_ID, workspaces: [DEMO_WORKSPACE], people: demoPeople(now), log: demoLog(now), facts: demoUsageFacts(now) }),
  });
}
