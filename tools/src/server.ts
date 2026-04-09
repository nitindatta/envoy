import Fastify from 'fastify';
import { loadSettings } from './settings.js';
import { makeAuthHook } from './auth.js';
import { ok } from './envelope.js';
import { registerSeekSearchRoute } from './providers/seek/search.js';
import { registerSeekDetailRoute } from './providers/seek/detail.js';
import { registerBrowserRoutes } from './browser/routes.js';

export function buildServer(secret: string) {
  const app = Fastify({ logger: { level: 'info' } });

  app.addHook('onRequest', makeAuthHook(secret));

  app.get('/health', async () => {
    return ok({ service: 'tools', status: 'up' });
  });

  registerSeekSearchRoute(app);
  registerSeekDetailRoute(app);
  registerBrowserRoutes(app);

  return app;
}

async function main(): Promise<void> {
  const settings = loadSettings();
  const app = buildServer(settings.internalAuthSecret);
  try {
    await app.listen({ host: settings.host, port: settings.port });
    app.log.info(`node-tool-service listening on http://${settings.host}:${settings.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only run main() when invoked directly, not when imported by tests.
// Normalise both sides to handle Windows path differences (backslashes, drive letters).
const _url = import.meta.url.toLowerCase().replace(/\\/g, '/');
const _argv = process.argv[1]
  ? `file:///${process.argv[1].replace(/\\/g, '/').replace(/^\//, '')}`.toLowerCase()
  : '';
if (_url === _argv) {
  void main();
}
