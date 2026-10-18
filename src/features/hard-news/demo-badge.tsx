'use client';

import { Badge } from '@content-ventures/design-system/v3';

/**
 * "Demo": a part of the R2 desk inside an R1 screen that still runs on simulated data, with no
 * backend yet. The same amber word the top bar shows on the R2 screens that are demo as a whole.
 */
export function DemoBadge() {
  return <Badge tone="amber" size="sm">Demo</Badge>;
}
