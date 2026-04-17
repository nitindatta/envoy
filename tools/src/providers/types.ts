import { z } from 'zod';

/**
 * Provider-neutral job record returned by every provider parser.
 *
 * Rules:
 *  - `posted_at` MUST be an ISO 8601 string (with timezone offset) or null.
 *    Parsers are responsible for normalising provider-specific relative time
 *    strings (e.g. "23d ago") before this type crosses the tools → agent
 *    boundary.
 *  - All nullable fields default to null when not present on the listing.
 *  - Array fields default to [] when not present.
 */
export interface ProviderJob {
  provider_job_id: string;
  title: string;
  company: string;
  location: string | null;
  url: string;
  posted_at: string | null; // ISO 8601 timestamp — parser must normalise before returning
  snippet: string | null;
  salary: string | null;
  work_type: string | null;
  work_arrangement: string | null;
  tags: string[];
  logo_url: string | null;
  bullet_points: string[];
}

export const providerJobSchema = z.object({
  provider_job_id: z.string().min(1),
  title: z.string().min(1),
  company: z.string(),
  location: z.string().nullable(),
  url: z.string().url(),
  posted_at: z.string().datetime({ offset: true }).nullable(),
  snippet: z.string().nullable(),
  salary: z.string().nullable().default(null),
  work_type: z.string().nullable().default(null),
  work_arrangement: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  logo_url: z.string().nullable().default(null),
  bullet_points: z.array(z.string()).default([]),
});
