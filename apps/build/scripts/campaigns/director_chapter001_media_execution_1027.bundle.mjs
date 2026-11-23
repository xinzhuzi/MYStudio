import path from 'node:path';
/** Only this task's exact production image handler receives the redirect boundary. */
export function executionTransportBoundary(repo) {
  const handler = path.join(repo, 'apps/frontend/electron/ipc/ai/api-request-ipc.ts');
  const adapter = path.join(repo, 'apps/build/scripts/director_chapter001_media_execution_1027.transport.mjs');
  const matches = (id, importer) => id === 'undici' && importer?.split('?')[0] === handler;
  let replacements = 0;
  return {
    matches,
    count: () => replacements,
    plugin: { name:'chapter001-scoped-image-transport', enforce:'pre', resolveId(id, importer) {
      if (matches(id, importer)) { replacements++; return adapter; }
    } },
  };
}
