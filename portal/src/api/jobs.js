import { apiFetch } from "./client";
import { jobListSchema, searchResponseSchema, } from "./schemas";
export async function fetchJobs(provider) {
    const query = provider ? `?provider=${encodeURIComponent(provider)}` : "";
    const raw = await apiFetch(`/jobs${query}`);
    return jobListSchema.parse(raw).jobs;
}
export async function runSearch(payload) {
    const raw = await apiFetch("/workflows/search", {
        method: "POST",
        body: JSON.stringify(payload),
    });
    return searchResponseSchema.parse(raw);
}
