import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJobs } from "../api/jobs";
import { triggerPrepare, approveApplication, discardApplication, } from "../api/applications";
export default function ReviewDeskPage() {
    const queryClient = useQueryClient();
    const [selectedJob, setSelectedJob] = useState(null);
    const [prepared, setPrepared] = useState(null);
    const [applicationId, setApplicationId] = useState(null);
    const [actionDone, setActionDone] = useState(null);
    const jobsQuery = useQuery({
        queryKey: ["jobs"],
        queryFn: () => fetchJobs(),
    });
    const prepareMutation = useMutation({
        mutationFn: (jobId) => triggerPrepare(jobId),
        onSuccess: (data) => {
            setPrepared(data);
            setApplicationId(data.application_id);
            setActionDone(null);
        },
    });
    const approveMutation = useMutation({
        mutationFn: (appId) => approveApplication(appId),
        onSuccess: () => {
            setActionDone("approved");
            queryClient.invalidateQueries({ queryKey: ["applications"] });
        },
    });
    const discardMutation = useMutation({
        mutationFn: (appId) => discardApplication(appId),
        onSuccess: () => {
            setActionDone("discarded");
            queryClient.invalidateQueries({ queryKey: ["applications"] });
        },
    });
    function handleSelectJob(job) {
        setSelectedJob(job);
        setPrepared(null);
        setApplicationId(null);
        setActionDone(null);
    }
    return (_jsxs("div", { style: { display: "flex", gap: "1.5rem", padding: "1.5rem" }, children: [_jsxs("div", { style: { width: 320, flexShrink: 0 }, children: [_jsx("h2", { style: { marginTop: 0 }, children: "Jobs" }), jobsQuery.isLoading && _jsx("p", { children: "Loading\u2026" }), jobsQuery.isError && _jsx("p", { style: { color: "red" }, children: "Failed to load jobs." }), jobsQuery.data?.map((job) => (_jsxs("div", { onClick: () => handleSelectJob(job), style: {
                            padding: "0.75rem",
                            marginBottom: "0.5rem",
                            border: selectedJob?.id === job.id ? "2px solid #2563eb" : "1px solid #e5e7eb",
                            borderRadius: 6,
                            cursor: "pointer",
                            background: selectedJob?.id === job.id ? "#eff6ff" : "#fff",
                        }, children: [_jsx("div", { style: { fontWeight: 600, fontSize: 14 }, children: job.title }), _jsx("div", { style: { color: "#6b7280", fontSize: 13 }, children: job.company }), job.location && (_jsx("div", { style: { color: "#9ca3af", fontSize: 12 }, children: job.location }))] }, job.id)))] }), _jsxs("div", { style: { flex: 1 }, children: [!selectedJob && (_jsx("p", { style: { color: "#6b7280" }, children: "Select a job from the list to prepare an application." })), selectedJob && !prepared && (_jsxs("div", { children: [_jsxs("h2", { style: { marginTop: 0 }, children: [selectedJob.title, " \u2014 ", selectedJob.company] }), selectedJob.location && _jsx("p", { style: { color: "#6b7280", margin: "0 0 0.25rem" }, children: selectedJob.location }), _jsx("a", { href: selectedJob.source_url, target: "_blank", rel: "noreferrer", style: { fontSize: 13 }, children: "View on SEEK \u2197" }), selectedJob.summary && (_jsx("div", { style: {
                                    margin: "1rem 0",
                                    padding: "0.75rem",
                                    background: "#f9fafb",
                                    border: "1px solid #e5e7eb",
                                    borderRadius: 6,
                                    fontSize: 14,
                                    color: "#374151",
                                    lineHeight: 1.6,
                                }, children: selectedJob.summary })), _jsxs("div", { style: { marginTop: "1rem" }, children: [_jsx("button", { onClick: () => prepareMutation.mutate(selectedJob.id), disabled: prepareMutation.isPending, style: {
                                            padding: "0.5rem 1.25rem",
                                            background: "#2563eb",
                                            color: "#fff",
                                            border: "none",
                                            borderRadius: 6,
                                            cursor: prepareMutation.isPending ? "not-allowed" : "pointer",
                                            fontSize: 14,
                                        }, children: prepareMutation.isPending
                                            ? "Preparing… (fetching & generating)"
                                            : "Prepare Application" }), prepareMutation.isError && (_jsxs("p", { style: { color: "red", marginTop: 8 }, children: ["Error:", " ", prepareMutation.error instanceof Error
                                                ? prepareMutation.error.message
                                                : "Unknown error"] }))] })] })), prepared && selectedJob && (_jsxs("div", { children: [_jsxs("h2", { style: { marginTop: 0 }, children: [selectedJob.title, " \u2014 ", selectedJob.company] }), prepared.is_suitable === false && (_jsxs("div", { style: {
                                    padding: "1rem",
                                    background: "#fef3c7",
                                    border: "1px solid #d97706",
                                    borderRadius: 6,
                                    marginBottom: "1.5rem",
                                }, children: [_jsx("p", { style: { fontWeight: 600, margin: "0 0 0.5rem", color: "#92400e" }, children: "Profile does not sufficiently match this role" }), prepared.gaps && prepared.gaps.length > 0 && (_jsx("ul", { style: { margin: 0, paddingLeft: "1.25rem", color: "#78350f", fontSize: 14 }, children: prepared.gaps.map((gap, i) => (_jsx("li", { children: gap }, i))) })), _jsx("p", { style: { margin: "0.75rem 0 0", fontSize: 13, color: "#92400e" }, children: "You can still discard this job or apply manually." })] })), prepared.is_suitable !== false && (_jsxs("section", { style: { marginBottom: "1.5rem" }, children: [_jsx("h3", { children: "Cover Letter" }), _jsx("textarea", { defaultValue: prepared.cover_letter, rows: 12, style: {
                                            width: "100%",
                                            padding: "0.75rem",
                                            border: "1px solid #d1d5db",
                                            borderRadius: 6,
                                            fontFamily: "inherit",
                                            fontSize: 14,
                                            resize: "vertical",
                                        } })] })), prepared.questions.length > 0 && (_jsxs("section", { style: { marginBottom: "1.5rem" }, children: [_jsx("h3", { children: "Predicted Interview Questions" }), prepared.questions.map((qa, i) => (_jsxs("div", { style: {
                                            marginBottom: "1rem",
                                            padding: "0.75rem",
                                            background: "#f9fafb",
                                            border: "1px solid #e5e7eb",
                                            borderRadius: 6,
                                        }, children: [_jsxs("p", { style: { fontWeight: 600, margin: "0 0 0.5rem" }, children: ["Q", i + 1, ": ", qa.question] }), _jsx("p", { style: { margin: 0, color: "#374151" }, children: qa.answer })] }, i)))] })), !actionDone && applicationId && (_jsxs("div", { style: { display: "flex", gap: "0.75rem" }, children: [_jsx("button", { onClick: () => approveMutation.mutate(applicationId), disabled: approveMutation.isPending, style: {
                                            padding: "0.5rem 1.25rem",
                                            background: "#16a34a",
                                            color: "#fff",
                                            border: "none",
                                            borderRadius: 6,
                                            cursor: "pointer",
                                            fontSize: 14,
                                        }, children: "Approve" }), _jsx("button", { onClick: () => discardMutation.mutate(applicationId), disabled: discardMutation.isPending, style: {
                                            padding: "0.5rem 1.25rem",
                                            background: "#dc2626",
                                            color: "#fff",
                                            border: "none",
                                            borderRadius: 6,
                                            cursor: "pointer",
                                            fontSize: 14,
                                        }, children: "Discard" })] })), actionDone && (_jsxs("p", { style: {
                                    fontWeight: 600,
                                    color: actionDone === "approved" ? "#16a34a" : "#dc2626",
                                }, children: ["Application ", actionDone, "."] }))] }))] })] }));
}
