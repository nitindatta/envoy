import { apiFetch } from "./client";
import {
  jobListSchema,
  searchResponseSchema,
  type Job,
  type SearchResponse,
} from "./schemas";

export async function fetchJobs(provider?: string): Promise<Job[]> {
  const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
  const raw = await apiFetch<unknown>(`/jobs${query}`);
  return jobListSchema.parse(raw).jobs;
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
