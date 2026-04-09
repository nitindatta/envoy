import { apiFetch } from "./client";
import { applicationSchema, applicationDetailSchema, applyStepResponseSchema, prepareResponseSchema, } from "./schemas";
import { z } from "zod";
export async function fetchApplications(state) {
    const url = state ? `/applications?state=${state}` : "/applications";
    const raw = await apiFetch(url);
    const parsed = z.object({ applications: z.array(applicationSchema) }).parse(raw);
    return parsed.applications;
}
export async function fetchApplicationDetail(appId) {
    const raw = await apiFetch(`/applications/${appId}`);
    return applicationDetailSchema.parse(raw);
}
export async function triggerPrepare(jobId) {
    const raw = await apiFetch("/workflows/prepare", {
        method: "POST",
        body: JSON.stringify({ job_id: jobId }),
    });
    return prepareResponseSchema.parse(raw);
}
export async function approveApplication(appId) {
    await apiFetch(`/applications/${appId}/approve`, { method: "POST" });
}
export async function discardApplication(appId) {
    await apiFetch(`/applications/${appId}/discard`, { method: "POST" });
}
export async function startApply(applicationId) {
    const raw = await apiFetch("/workflows/apply", {
        method: "POST",
        body: JSON.stringify({ application_id: applicationId }),
    });
    return applyStepResponseSchema.parse(raw);
}
export async function resumeApply(runId, approvedValues, actionLabel = "Continue", action = "continue") {
    const raw = await apiFetch(`/workflows/apply/${runId}/resume`, {
        method: "POST",
        body: JSON.stringify({ approved_values: approvedValues, action_label: actionLabel, action }),
    });
    return applyStepResponseSchema.parse(raw);
}
