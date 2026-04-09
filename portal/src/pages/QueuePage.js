import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApplications, fetchApplicationDetail, discardApplication } from "../api/applications";
const STATE_COLOURS = {
    prepared: "#d97706",
    approved: "#2563eb",
    discarded: "#6b7280",
    submitted: "#16a34a",
};
export default function QueuePage() {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const [selected, setSelected] = useState(null);
    const appsQuery = useQuery({
        queryKey: ["applications", "approved"],
        queryFn: () => fetchApplications("approved"),
    });
    const detailQuery = useQuery({
        queryKey: ["application-detail", selected?.id],
        queryFn: () => fetchApplicationDetail(selected.id),
        enabled: !!selected,
    });
    const discardMutation = useMutation({
        mutationFn: (appId) => discardApplication(appId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["applications"] });
            setSelected(null);
        },
    });
    const coverLetter = detailQuery.data?.drafts.find((d) => d.draft_type === "cover_letter");
    const qaDrafts = detailQuery.data?.drafts.filter((d) => d.draft_type === "question_answer") ?? [];
    return (_jsxs("div", { style: { display: "flex", gap: "1.5rem" }, children: [_jsxs("div", { style: { width: 300, flexShrink: 0 }, children: [_jsxs("h2", { style: { marginTop: 0 }, children: ["Approved (", appsQuery.data?.length ?? 0, ")"] }), appsQuery.isLoading && _jsx("p", { children: "Loading\u2026" }), appsQuery.data?.length === 0 && (_jsx("p", { style: { color: "#6b7280", fontSize: 14 }, children: "No approved applications yet. Prepare and approve jobs from the Review Desk." })), appsQuery.data?.map((app) => (_jsxs("div", { onClick: () => setSelected(app), style: {
                            padding: "0.75rem",
                            marginBottom: "0.5rem",
                            border: selected?.id === app.id ? "2px solid #2563eb" : "1px solid #e5e7eb",
                            borderRadius: 6,
                            cursor: "pointer",
                            background: selected?.id === app.id ? "#eff6ff" : "#fff",
                        }, children: [_jsx("div", { style: { fontWeight: 600, fontSize: 14 }, children: app.job_title ?? "Unknown job" }), _jsx("div", { style: { color: "#6b7280", fontSize: 13 }, children: app.job_company }), app.job_location && (_jsx("div", { style: { color: "#9ca3af", fontSize: 12 }, children: app.job_location })), _jsx("div", { style: { marginTop: 4 }, children: _jsx("span", { style: {
                                        fontSize: 11,
                                        fontWeight: 600,
                                        color: STATE_COLOURS[app.state] ?? "#374151",
                                        textTransform: "uppercase",
                                        letterSpacing: "0.05em",
                                    }, children: app.state }) })] }, app.id)))] }), _jsxs("div", { style: { flex: 1 }, children: [!selected && (_jsx("p", { style: { color: "#6b7280" }, children: "Select an application to review its drafts." })), selected && (_jsxs("div", { children: [_jsxs("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start" }, children: [_jsxs("div", { children: [_jsxs("h2", { style: { marginTop: 0 }, children: [selected.job_title, " \u2014 ", selected.job_company] }), selected.job_location && (_jsx("p", { style: { color: "#6b7280", margin: "0 0 0.5rem" }, children: selected.job_location })), selected.job_source_url && (_jsx("a", { href: selected.job_source_url, target: "_blank", rel: "noreferrer", style: { fontSize: 13 }, children: "View on SEEK \u2197" }))] }), _jsxs("div", { style: { display: "flex", gap: "0.5rem" }, children: [_jsx("button", { onClick: () => navigate(`/apply/${selected.id}`), style: {
                                                    padding: "0.4rem 1rem",
                                                    background: "#2563eb",
                                                    color: "#fff",
                                                    border: "none",
                                                    borderRadius: 6,
                                                    cursor: "pointer",
                                                    fontSize: 13,
                                                    fontWeight: 600,
                                                }, children: "Apply" }), _jsx("button", { onClick: () => discardMutation.mutate(selected.id), disabled: discardMutation.isPending, style: {
                                                    padding: "0.4rem 1rem",
                                                    background: "#dc2626",
                                                    color: "#fff",
                                                    border: "none",
                                                    borderRadius: 6,
                                                    cursor: "pointer",
                                                    fontSize: 13,
                                                }, children: "Discard" })] })] }), selected.job_summary && (_jsx("div", { style: {
                                    margin: "1rem 0",
                                    padding: "0.75rem",
                                    background: "#f9fafb",
                                    border: "1px solid #e5e7eb",
                                    borderRadius: 6,
                                    fontSize: 14,
                                    color: "#374151",
                                }, children: selected.job_summary })), detailQuery.isLoading && _jsx("p", { children: "Loading drafts\u2026" }), coverLetter && (_jsxs("section", { style: { marginBottom: "1.5rem" }, children: [_jsx("h3", { children: "Cover Letter" }), _jsx("textarea", { defaultValue: coverLetter.content, rows: 12, style: {
                                            width: "100%",
                                            padding: "0.75rem",
                                            border: "1px solid #d1d5db",
                                            borderRadius: 6,
                                            fontFamily: "inherit",
                                            fontSize: 14,
                                            resize: "vertical",
                                            boxSizing: "border-box",
                                        } })] })), qaDrafts.length > 0 && (_jsxs("section", { children: [_jsx("h3", { children: "Predicted Interview Questions" }), qaDrafts.map((draft, i) => {
                                        let qa = { question: "", answer: "" };
                                        try {
                                            qa = JSON.parse(draft.content);
                                        }
                                        catch { /* ignore */ }
                                        return (_jsxs("div", { style: {
                                                marginBottom: "1rem",
                                                padding: "0.75rem",
                                                background: "#f9fafb",
                                                border: "1px solid #e5e7eb",
                                                borderRadius: 6,
                                            }, children: [_jsxs("p", { style: { fontWeight: 600, margin: "0 0 0.5rem" }, children: ["Q", i + 1, ": ", qa.question] }), _jsx("p", { style: { margin: 0, color: "#374151" }, children: qa.answer })] }, draft.id));
                                    })] }))] }))] })] }));
}
