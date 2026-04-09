import type { FastifyReply, FastifyRequest } from 'fastify';
import { error } from './envelope.js';

/**
 * Shared-secret auth for the internal tool API.
 * Python passes X-Internal-Auth on every call.
 * Localhost bind + this header is the full auth model for v1.
 */
export function makeAuthHook(secret: string) {
  return async function authHook(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers['x-internal-auth'];
    if (typeof header !== 'string' || header !== secret) {
      // Auth failure is still returned as HTTP 200 with error envelope,
      // except for health check which is unauthenticated.
      if (request.url === '/health') {
        return;
      }
      void reply.code(200).send(error('unauthorized', 'Missing or invalid X-Internal-Auth header'));
    }
  };
}
