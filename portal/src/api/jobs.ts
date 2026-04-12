import { apiFetch } from "./client";
import {
  jobListSchema,
  searchResponseSchema,
  type Job,
  type SearchResponse,
} from "./schemas";

export async function fetchJobs(opts?: { provider?: string; state?: string }): Promise<Job[]> {
  const params = new URLSearchParams();
  if (opts?.provider) params.set("provider", opts.provider);
  if (opts?.state) params.set("state", opts.state);
  const query = params.toString() ? `?${params.toString()}` : "";
  const raw = await apiFetch<unknown>(`/jobs${query}`);
  return jobListSchema.parse(raw).jobs;
}

export async function queueJob(jobId: string): Promise<void> {
  await apiFetch<unknown>(`/jobs/${jobId}/queue`, { method: "POST" });
}

export async function ignoreJob(jobId: string): Promise<void> {
  await apiFetch<unknown>(`/jobs/${jobId}/ignore`, { method: "POST" });
}

export interface SearchPayload {
  provider: string;
  keywords: string;
  location?: string;
  max_pages?: number;
}

export async function runSearch(payload: SearchPayload): Promise<SearchResponse> {
  const raw = await apiFetch<unknown>("/workflows/search", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return searchResponseSchema.parse(raw);
}
