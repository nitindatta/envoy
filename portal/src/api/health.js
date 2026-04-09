import { apiFetch } from "./client";
import { healthSchema } from "./schemas";
export async function fetchHealth() {
    const raw = await apiFetch("/health");
    return healthSchema.parse(raw);
}
