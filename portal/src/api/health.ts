import { apiFetch } from "./client";
import { healthSchema, type Health } from "./schemas";

export async function fetchHealth(): Promise<Health> {
  const raw = await apiFetch<unknown>("/health");
  return healthSchema.parse(raw);
}
