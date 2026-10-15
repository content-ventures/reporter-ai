/** The worker's triggers, declared once: neon.ts deploys them and the release checks them. */
export const WORKER_TRIGGERS = /** @type {const} */ ({
  // Hourly safety sweep. The app wakes the worker on demand, so this only catches work whose
  // wake-up was lost. The legacy name is kept on purpose: triggers are matched by name, and a
  // renamed trigger would leave the old every-minute schedule firing.
  'reporter-editorial-every-minute': {
    type: 'schedule', function: 'reporterworker', cron: '0 * * * *', functionPath: '/triggers/schedule', enabled: true,
  },
  'reporter-source-uploaded': {
    type: 'storage_object_created', function: 'reporterworker', bucket: 'reporter-source-media',
    prefix: 'incoming/', functionPath: '/triggers/storage', enabled: true,
  },
});

/** A schedule may fire at most once an hour: one fixed minute, every other field free. */
export function scheduleTooFrequent(cron) {
  const [minute] = String(cron).trim().split(/\s+/);
  return !/^[0-5]?\d$/.test(minute);
}
