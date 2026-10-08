import type { Clock, IdGenerator } from '../system.ts';
import type { PortsFactory } from './fixture.ts';
import { ingestPortContract } from './ingest.contract.ts';
import { productionPortsContract } from './production.contract.ts';
import { reviewPortsContract } from './review.contract.ts';
import { sessionPortContract } from './session.contract.ts';
import { systemPortsContract } from './system.contract.ts';

/**
 * Every port contract in one call. The local simulation runs it now; a backend/AI adapter must
 * pass it unchanged before it replaces the simulation (`node --test`).
 */
export function allPortContracts(name: string, make: PortsFactory, system: () => { clock: Clock; ids: IdGenerator }): void {
  systemPortsContract(name, system);
  sessionPortContract(name, make);
  ingestPortContract(name, make);
  productionPortsContract(name, make);
  reviewPortsContract(name, make);
}

export type { PortsFactory, PortsUnderTest } from './fixture.ts';
