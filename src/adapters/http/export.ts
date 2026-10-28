import type { ExportRequest, ExportService, ExportServiceRefusal } from '../../ports/export.ts';
import type { Result } from '../../domain/result.ts';
import type { VersionRef } from '../../domain/refs.ts';
import type { ReporterTransport } from './reporter-client.ts';

/** Validate current server approvals and bank evidence before preparing any downloadable bytes. */
export function createHttpExportService(local: ExportService, http: ReporterTransport): ExportService {
  const prepare = async (request: ExportRequest) => {
    const plan = await local.plan(request);
    if (!plan.ok) return plan;
    const result = await http.request<Result<VersionRef[], ExportServiceRefusal>>('/exports/prepare', {
      productionId: request.productionId, selection: plan.value.selection,
    });
    return result.ok ? { ...plan, value: { ...plan.value, selection: result.value } } : result;
  };
  return {
    plan: prepare,
    async build(request) {
      const prepared = await prepare(request);
      return prepared.ok ? local.build({ ...request, selection: prepared.value.selection }) : prepared;
    },
    async buildFile(request) {
      const prepared = await prepare(request);
      return prepared.ok ? local.buildFile({ ...request, selection: prepared.value.selection }) : prepared;
    },
  };
}
