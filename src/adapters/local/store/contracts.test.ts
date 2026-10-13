import { allPortContracts } from '../../../ports/contracts/ports.contract.ts';
import { memoryStorage } from './storage.ts';
import { createIdGenerator, manualClock, sequentialIds, systemClock } from './system.ts';
import { createTestPorts, TEST_START, toPortsUnderTest } from './testing.ts';

/** The local simulated adapter must pass every port contract a real backend will face. */

allPortContracts('local store (localStorage)', () => toPortsUnderTest(createTestPorts({ storage: memoryStorage() })), () => ({
  clock: systemClock(),
  ids: createIdGenerator(),
}));

allPortContracts('local store (memory only)', () => toPortsUnderTest(createTestPorts()), () => ({
  clock: manualClock(TEST_START),
  ids: sequentialIds(),
}));
