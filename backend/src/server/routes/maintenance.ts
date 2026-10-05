import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { MaintenanceService, MaintenancePolicyOverrides } from '../../maintenance/service';

export function setupMaintenanceRoutes(app: FastifyInstance, maintenanceService: MaintenanceService): void {
  app.get('/api/maintenance/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    reply.send({ data: { lastResult: maintenanceService.getLastResult() } });
  });

  app.get('/api/maintenance/preview', async (request: FastifyRequest, reply: FastifyReply) => {
    const overrides = parseOverrides(request.query as Record<string, string | undefined>);
    const result = await maintenanceService.preview(overrides);
    reply.send({ data: result });
  });

  app.post('/api/maintenance/cleanup', async (request: FastifyRequest, reply: FastifyReply) => {
    const body = (request.body ?? {}) as MaintenancePolicyOverrides & { dryRun?: boolean };
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const overrides: MaintenancePolicyOverrides = { ...parseOverrides(query), ...body };
    const dryRun = body.dryRun === true || query.dryRun === 'true' || query.dryRun === '1';
    const result = await maintenanceService.run(overrides, { dryRun });
    reply.send({ data: result });
  });
}

function parseOverrides(query: Record<string, string | undefined>): MaintenancePolicyOverrides {
  const overrides: MaintenancePolicyOverrides = {};
  const toNumber = (value?: string): number | undefined => {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  const toBoolean = (value?: string): boolean | undefined => {
    if (value === undefined) return undefined;
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
    return undefined;
  };
  const tasksRetainDays = toNumber(query.tasksRetainDays);
  const discoveryJobsRetainDays = toNumber(query.discoveryJobsRetainDays ?? query.jobsRetainDays);
  const browserProfilesRetainDays = toNumber(query.browserProfilesRetainDays ?? query.profilesRetainDays);
  const batchLimit = toNumber(query.batchLimit);
  const deleteFiles = toBoolean(query.deleteFiles);
  const deleteOrphanProfiles = toBoolean(query.deleteOrphanProfiles);
  if (tasksRetainDays !== undefined) overrides.tasksRetainDays = tasksRetainDays;
  if (discoveryJobsRetainDays !== undefined) overrides.discoveryJobsRetainDays = discoveryJobsRetainDays;
  if (browserProfilesRetainDays !== undefined) overrides.browserProfilesRetainDays = browserProfilesRetainDays;
  if (batchLimit !== undefined) overrides.batchLimit = batchLimit;
  if (deleteFiles !== undefined) overrides.deleteFiles = deleteFiles;
  if (deleteOrphanProfiles !== undefined) overrides.deleteOrphanProfiles = deleteOrphanProfiles;
  return overrides;
}
