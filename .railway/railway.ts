import { defineRailway, github, project, service } from 'railway/iac';

export const partial = 'relay';

/** The game itself is on Vercel, built with VITE_MULTIPLAYER_URL pointing here. */
export default defineRailway(() => {
  const relay = service('relay', {
    source: github('guerinnoah/open-world-antwerp', { branch: 'main' }),
    // client-only pushes would otherwise restart the relay and drop everyone
    build: { builder: 'RAILPACK', watchPatterns: ['server/**', 'src/net/protocol.ts', 'package.json', 'pnpm-lock.yaml'] },
    start: 'node server/main.ts',
    healthcheck: '/health',
    replicas: { 'europe-west4-drams3a': 1 }, // the one world lives in memory, so exactly one instance
    env: { TRUST_PROXY: '1' }, // behind Railway's proxy: per-address limits read X-Forwarded-For
  });

  return project('open-world-antwerp', {
    variables: { managed: true },
    resources: [relay],
  });
});
