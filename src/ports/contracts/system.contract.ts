import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Clock, IdGenerator } from '../system.ts';

/** Clock and IdGenerator contract: ISO instants, unique prefixed ids (no crypto.randomUUID). */
export function systemPortsContract(name: string, make: () => { clock: Clock; ids: IdGenerator }): void {
  describe(`${name} · clock and id contract`, () => {
    it('returns parseable ISO-8601 instants that never go backwards', () => {
      const { clock } = make();
      const first = clock.now();
      const second = clock.now();
      assert.match(first, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
      assert.ok(Date.parse(second) >= Date.parse(first));
    });

    it('returns unique ids that keep their prefix', () => {
      const { ids } = make();
      const seen = new Set<string>();
      for (let index = 0; index < 5000; index += 1) {
        const id = ids.next(index % 2 === 0 ? 'ver' : 'dec');
        assert.ok(id.startsWith(index % 2 === 0 ? 'ver-' : 'dec-'));
        seen.add(id);
      }
      assert.equal(seen.size, 5000);
    });
  });
}
