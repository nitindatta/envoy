import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { startApply, resumeApply } from "../api/applications";
export default function ApplyPage() {
    const { applicationId } = useParams();
    const navigate = useNavigate();
    const [phase, setPhase] = useState("idle");
    const [response, setResponse] = useState(null);
    const [editedValues, setEditedValues] = useState({});
    const [errorMsg, setErrorMsg] = useState("");
    // Start the apply workflow
    const startMutation = useMutation({
        mutationFn: () => startApply(applicationId),
        onMutate: () => setPhase("starting"),
        onSuccess: (data) => {
            setResponse(data);
            setEditedValues({ ...data.proposed_values });
            if (data.status === "paused" || data.status === "running") {
                setPhase("gate");
            }
            else {
                setPhase("done");
            }
        },
        onError: (err) => {
            setErrorMsg(err.message);
            setPhase("error");
        },
    });
    // Resume after user approves a step
    const resumeMutation = useMutation({
        mutationFn: ({ actionLabel, }) => resumeApply(response.workflow_run_id, editedValues, actionLabel),
        onSuccess: (data) => {
            setResponse(data);
            setEditedValues({ ...data.proposed_values });
            if (data.status === "paused" || data.status === "running") {
                setPhase("gate");
            }
            else {
                setPhase("done");
            }
        },
        onError: (err) => {
            setErrorMsg(err.message);
            setPhase("error");
        },
    });
    // Abort
    const abortMutation = useMutation({
        mutationFn: () => resumeApply(response.workflow_run_id, {}, "Continue", "abort"),
        onSuccess: () => {
            navigate("/queue");
        },
    });
    const step = response?.step;
    const isExternal = step?.is_external_portal;
    const isAuthRequired = step?.page_type === "auth_required";
    const isConfirmed = response?.status === "completed";
    const isFailed = response?.status === "failed";
    return (_jsxs("div", { style: { maxWidth: 720, margin: "0 auto" }, children: [_jsx("h1", { style: { marginBottom: "0.5rem" }, children: "Apply" }), _jsxs("p", { style: { color: "#6b7280", fontSize: 14, marginBottom: "1.5rem" }, children: ["Application ID: ", applicationId] }), phase === "idle" && (_jsx("button", { onClick: () => startMutation.mutate(), style: btnStyle("#2563eb"), children: "Start Apply" })), phase === "starting" && (_jsx("p", { style: { color: "#6b7280" }, children: "Opening browser and navigating to application\u2026" })), phase === "done" && isConfirmed && (_jsxs("div", { style: alertStyle("#dcfce7", "#16a34a"), children: ["Application submitted successfully!", " ", _jsx("button", { onClick: () => navigate("/queue"), style: { background: "none", border: "none", color: "#16a34a", cursor: "pointer", fontWeight: 600 }, children: "Back to Queue" })] })), (phase === "done" && isFailed) || phase === "error" ? (_jsxs("div", { style: alertStyle("#fee2e2", "#dc2626"), children: [isFailed ? `Workflow failed: ${response?.step?.page_url ?? "unknown step"}` : errorMsg, _jsx("br", {}), _jsx("button", { onClick: () => navigate("/queue"), style: { background: "none", border: "none", color: "#dc2626", cursor: "pointer", marginTop: 8 }, children: "Back to Queue" })] })) : null, phase === "gate" && isAuthRequired && (_jsxs("div", { style: alertStyle("#fef3c7", "#d97706"), children: [_jsx("strong", { children: "SEEK login required." }), " The browser window opened but SEEK requires you to be logged in. Please log in to SEEK in the Chrome window that just opened, then click Retry below.", _jsxs("div", { style: { marginTop: 12, display: "flex", gap: "0.75rem" }, children: [_jsx("button", { onClick: () => startMutation.mutate(), style: btnStyle("#2563eb"), children: "Retry Apply" }), _jsx("button", { onClick: () => navigate("/queue"), style: btnStyle("#6b7280"), children: "Back to Queue" })] })] })), phase === "gate" && isExternal && !isAuthRequired && (_jsxs("div", { style: alertStyle("#fef3c7", "#d97706"), children: [_jsx("strong", { children: "External portal detected." }), " ", step?.portal_type && _jsxs("span", { children: ["Portal type: ", step.portal_type, ". "] }), "This job requires manual application on the employer's own site.", _jsxs("div", { style: { marginTop: 12 }, children: [step?.page_url && (_jsx("a", { href: step.page_url, target: "_blank", rel: "noreferrer", style: { marginRight: 12, color: "#d97706", fontWeight: 600 }, children: "Open Portal \u2197" })), _jsx("button", { onClick: () => navigate("/queue"), style: btnStyle("#6b7280"), children: "Back to Queue" })] })] })), phase === "gate" && !isExternal && !isAuthRequired && step && (_jsxs("div", { children: [step.step_index != null && (_jsxs("p", { style: { color: "#6b7280", fontSize: 13, marginBottom: "0.75rem" }, children: ["Step ", step.step_index, step.total_steps_estimate ? ` of ${step.total_steps_estimate}` : ""] })), step.fields.length === 0 ? (_jsx("p", { style: { color: "#6b7280", fontSize: 14 }, children: "No fields detected on this step." })) : (_jsxs(_Fragment, { children: [response?.low_confidence_ids && response.low_confidence_ids.length > 0 && (_jsx("p", { style: { fontSize: 13, color: "#d97706", marginBottom: "0.5rem" }, children: "Highlighted fields need your review \u2014 the AI wasn't confident about the answer." })), _jsx("div", { style: { display: "flex", flexDirection: "column", gap: "1rem", marginBottom: "1.5rem" }, children: step.fields.map((field) => {
                                    const needsReview = response?.low_confidence_ids?.includes(field.id);
                                    return (_jsx(FieldEditor, { field: field, value: editedValues[field.id] ?? "", onChange: (val) => setEditedValues((prev) => ({ ...prev, [field.id]: val })), highlight: needsReview }, field.id));
                                }) })] })), _jsxs("div", { style: { display: "flex", gap: "0.75rem", flexWrap: "wrap" }, children: [step.visible_actions.length > 0 ? (step.visible_actions.map((action) => (_jsx("button", { onClick: () => resumeMutation.mutate({ actionLabel: action }), disabled: resumeMutation.isPending, style: btnStyle(action.toLowerCase().includes("submit") ? "#16a34a" : "#2563eb"), children: resumeMutation.isPending ? "Filling…" : action }, action)))) : (_jsx("button", { onClick: () => resumeMutation.mutate({ actionLabel: "Continue" }), disabled: resumeMutation.isPending, style: btnStyle("#2563eb"), children: resumeMutation.isPending ? "Filling…" : "Continue" })), _jsx("button", { onClick: () => abortMutation.mutate(), disabled: abortMutation.isPending, style: btnStyle("#dc2626"), children: "Abort" })] }), resumeMutation.isError && (_jsx("p", { style: { color: "#dc2626", marginTop: 8, fontSize: 13 }, children: resumeMutation.error.message }))] }))] }));
}
// ── Field editor ───────────────────────────────────────────────────────────
function FieldEditor({ field, value, onChange, highlight, }) {
    const borderColor = highlight ? "#d97706" : "#d1d5db";
    const labelEl = (_jsxs("label", { style: { fontSize: 13, fontWeight: 600, color: highlight ? "#d97706" : "#374151", display: "block", marginBottom: 4 }, children: [field.label, field.required && _jsx("span", { style: { color: "#dc2626", marginLeft: 4 }, children: "*" })] }));
    if (field.field_type === "select" && field.options?.length) {
        return (_jsxs("div", { children: [labelEl, _jsxs("select", { value: value, onChange: (e) => onChange(e.target.value), style: { ...inputStyle, border: `1px solid ${borderColor}` }, children: [_jsx("option", { value: "", children: "\u2014 select \u2014" }), field.options.map((opt) => (_jsx("option", { value: opt, children: opt }, opt)))] })] }));
    }
    if (field.field_type === "radio" && field.options?.length) {
        return (_jsxs("div", { children: [labelEl, _jsx("div", { style: { display: "flex", gap: "1rem", flexWrap: "wrap" }, children: field.options.map((opt) => (_jsxs("label", { style: { fontSize: 14, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }, children: [_jsx("input", { type: "radio", name: field.id, value: opt, checked: value === opt, onChange: () => onChange(opt) }), opt] }, opt))) })] }));
    }
    if (field.field_type === "textarea") {
        return (_jsxs("div", { children: [labelEl, _jsx("textarea", { value: value, onChange: (e) => onChange(e.target.value), rows: 6, maxLength: field.max_length ?? undefined, style: { ...inputStyle, border: `1px solid ${borderColor}`, resize: "vertical", height: "auto" } }), field.max_length && (_jsxs("div", { style: { fontSize: 11, color: "#9ca3af", textAlign: "right" }, children: [value.length, " / ", field.max_length] }))] }));
    }
    // Default: text input
    return (_jsxs("div", { children: [labelEl, _jsx("input", { type: "text", value: value, onChange: (e) => onChange(e.target.value), maxLength: field.max_length ?? undefined, style: { ...inputStyle, border: `1px solid ${borderColor}` } })] }));
}
// ── Style helpers ──────────────────────────────────────────────────────────
const inputStyle = {
    width: "100%",
    padding: "0.5rem 0.75rem",
    border: "1px solid #d1d5db", // overridden per-field via borderColor
    borderRadius: 6,
    fontSize: 14,
    fontFamily: "inherit",
    boxSizing: "border-box",
};
function btnStyle(bg) {
    return {
        padding: "0.5rem 1.25rem",
        background: bg,
        color: "#fff",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        fontSize: 14,
        fontWeight: 600,
    };
}
function alertStyle(bg, border) {
    return {
        padding: "1rem",
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 6,
        color: border,
        marginBottom: "1rem",
    };
}
