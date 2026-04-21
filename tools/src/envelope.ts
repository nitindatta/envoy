import { z } from 'zod';

/**
 * Standard response envelope for all tool calls from the Python agent.
 * Node tool endpoints always return HTTP 200 with this shape.
 * HTTP 5xx is reserved for the Node server itself being broken.
 */

export const DriftSchema = z.object({
  parser_id: z.string(),
  expected: z.string(),
  observed: z.string(),
  page_snapshot: z.string().optional(),
});

export const ArtifactSchema = z.object({
  type: z.string(),
  path: z.string(),
});

export const ErrorSchema = z.object({
  type: z.string(),
  message: z.string(),
});

export const ToolStatus = z.enum(['ok', 'error', 'drift', 'needs_human']);
export type ToolStatus = z.infer<typeof ToolStatus>;

export type ToolResponse<T> = {
  status: ToolStatus;
  data?: T;
  error?: z.infer<typeof ErrorSchema>;
  drift?: z.infer<typeof DriftSchema>;
  artifacts?: z.infer<typeof ArtifactSchema>[];
};

export function ok<T>(data: T, artifacts?: z.infer<typeof ArtifactSchema>[]): ToolResponse<T> {
  return { status: 'ok', data, artifacts };
}

export function error(
  type: string,
  message: string,
  artifacts?: z.infer<typeof ArtifactSchema>[],
): ToolResponse<never> {
  return { status: 'error', error: { type, message }, artifacts };
}

export function drift(
  parserId: string,
  expected: string,
  observed: string,
  pageSnapshot?: string,
): ToolResponse<never> {
  return {
    status: 'drift',
    drift: { parser_id: parserId, expected, observed, page_snapshot: pageSnapshot },
  };
}

export function needsHuman(type: string, message: string): ToolResponse<never> {
  return { status: 'needs_human', error: { type, message } };
}
