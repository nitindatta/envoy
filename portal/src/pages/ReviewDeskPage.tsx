import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchJobs, ignoreJob } from "../api/jobs";
import {
  triggerPrepare,
  approveApplication,
  discardApplication,
  startApply,
  submitApply,
  generateQuestions,
  markSubmitted,
} from "../api/applications";
import type { PrepareResponse, ApplyStepResponse } from "../api/schemas";
import type { Job } from "../api/schemas";

export default function ReviewDeskPage() {
  const queryClient = useQueryClient();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [prepared, setPrepared] = useState<PrepareResponse | null>(null);
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [actionDone, setActionDone] = useState<"approved" | "discarded" | null>(null);
  const [coverLetterText, setCoverLetterText] = useState<string>("");
  const [applyState, setApplyState] = useState<ApplyStepResponse | null>(null);
  const [questions, setQuestions] = useState<Array<{ question: string; answer: string }>>([]);

  const jobsQuery = useQuery({
    queryKey: ["jobs", "in_review"],
    queryFn: () => fetchJobs({ state: "in_review" }),
  });

  const prepareMutation = useMutation({
    mutationFn: (jobId: string) => triggerPrepare(jobId),
    onSuccess: (data) => {
      setPrepared(data);
      setApplicationId(data.application_id);
      setActionDone(null);
      setApplyState(null);
      setQuestions([]);
      setCoverLetterText(data.cover_letter ?? "");
    },
  });

  const approveMutation = useMutation({
    mutationFn: (appId: string) => approveApplication(appId, coverLetterText),
    onSuccess: () => {
      setActionDone("approved");
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  // Discard application + ignore the job so it leaves the Review Desk list
  const discardMutation = useMutation({
    mutationFn: async (params: { appId: string | null; jobId: string }) => {
      if (params.appId) await discardApplication(params.appId);
      await ignoreJob(params.jobId);
    },
    onSuccess: () => {
      setActionDone("discarded");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  const questionsMutation = useMutation({
    mutationFn: (appId: string) => generateQuestions(appId),
    onSuccess: (data) => setQuestions(data),
  });

  const applyMutation = useMutation({
    mutationFn: (appId: string) => startApply(appId),
    onSuccess: (data) => {
      setApplyState(data);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  const submitMutation = useMutation({
    mutationFn: ({ runId, label }: { runId: string; label: string }) =>
      submitApply(runId, label),
    onSuccess: (data) => {
      setApplyState(data);
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  const markSubmittedMutation = useMutation({
    mutationFn: (appId: string) => markSubmitted(appId),
    onSuccess: () => {
      setActionDone("approved");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  const [showEvidence, setShowEvidence] = useState(true);

  const parsedEvidence = useMemo(() => {
    if (!prepared?.match_evidence) return [];
    return prepared.match_evidence
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^\[(STRONG|MODERATE|WEAK)\]\s*(.+?)\s*→\s*(.+)$/);
        if (m) return { rating: m[1] as "STRONG" | "MODERATE" | "WEAK", requirement: m[2], evidence: m[3] };
        return null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }, [prepared?.match_evidence]);

  function handleSelectJob(job: Job) {
    setSelectedJob(job);
    setPrepared(null);
    setApplicationId(null);
    setActionDone(null);
    setApplyState(null);
    setQuestions([]);
    setShowEvidence(true);
  }

  return (
    <div style={{ display: "flex", gap: "1.5rem", padding: "1.5rem" }}>
      {/* Job list */}
      <div style={{ width: 280, flexShrink: 0 }}>
        <h2 style={{ marginTop: 0 }}>Jobs in Review</h2>
        {jobsQuery.isLoading && <p>Loading…</p>}
        {jobsQuery.isError && <p style={{ color: "red" }}>Failed to load jobs.</p>}
        {jobsQuery.data?.length === 0 && (
          <p style={{ color: "#6b7280", fontSize: 13 }}>No jobs in review. Queue some from the Jobs page.</p>
        )}
        {jobsQuery.data?.map((job) => (
          <div
            key={job.id}
            onClick={() => handleSelectJob(job)}
            style={{
              padding: "0.75rem",
              marginBottom: "0.5rem",
              border: selectedJob?.id === job.id ? "2px solid #2563eb" : "1px solid #e5e7eb",
              borderRadius: 6,
              cursor: "pointer",
              background: selectedJob?.id === job.id ? "#eff6ff" : "#fff",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>{job.title}</div>
            <div style={{ color: "#6b7280", fontSize: 13 }}>{job.company}</div>
            {job.location && (
              <div style={{ color: "#9ca3af", fontSize: 12 }}>{job.location}</div>
            )}
          </div>
        ))}
      </div>

      {/* Review panel */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selectedJob && (
          <p style={{ color: "#6b7280" }}>Select a job from the list to prepare an application.</p>
        )}

        {selectedJob && !prepared && (
          <div>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" }}>
              <div>
                <h2 style={{ marginTop: 0, marginBottom: "0.25rem" }}>
                  {selectedJob.title} — {selectedJob.company}
                </h2>
                {selectedJob.location && <p style={{ color: "#6b7280", margin: "0 0 0.25rem", fontSize: 13 }}>{selectedJob.location}</p>}
                <a href={selectedJob.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                  View on SEEK ↗
                </a>
              </div>
              {/* Discard job before preparing */}
              <button
                onClick={() => discardMutation.mutate({ appId: null, jobId: selectedJob.id })}
                disabled={discardMutation.isPending}
                style={{
                  padding: "0.4rem 1rem",
                  background: "#fff",
                  color: "#dc2626",
                  border: "1px solid #dc2626",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 13,
                  flexShrink: 0,
                }}
              >
                Discard Job
              </button>
            </div>
            {selectedJob.summary && (
              <div
                style={{
                  margin: "1rem 0",
                  padding: "0.75rem",
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "#374151",
                  lineHeight: 1.6,
                }}
              >
                {selectedJob.summary}
              </div>
            )}
            <div style={{ marginTop: "1rem" }}>
              <button
                onClick={() => prepareMutation.mutate(selectedJob.id)}
                disabled={prepareMutation.isPending}
                style={{
                  padding: "0.5rem 1.25rem",
                  background: "#2563eb",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: prepareMutation.isPending ? "not-allowed" : "pointer",
                  fontSize: 14,
                }}
              >
                {prepareMutation.isPending
                  ? "Preparing… (fetching & generating)"
                  : "Prepare Application"}
              </button>
              {prepareMutation.isError && (
                <p style={{ color: "red", marginTop: 8 }}>
                  Error:{" "}
                  {prepareMutation.error instanceof Error
                    ? prepareMutation.error.message
                    : "Unknown error"}
                </p>
              )}
            </div>
          </div>
        )}

        {prepared && selectedJob && (
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1rem" }}>
              <h2 style={{ margin: 0 }}>
                {selectedJob.title} — {selectedJob.company}
              </h2>
              <a href={selectedJob.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                View on SEEK ↗
              </a>
            </div>

            {/* Not a fit banner */}
            {prepared.is_suitable === false && (
              <div
                style={{
                  padding: "1rem",
                  background: "#fef3c7",
                  border: "1px solid #d97706",
                  borderRadius: 6,
                  marginBottom: "1.5rem",
                }}
              >
                <p style={{ fontWeight: 600, margin: "0 0 0.5rem", color: "#92400e" }}>
                  Profile does not sufficiently match this role
                </p>
                {prepared.gaps && prepared.gaps.length > 0 && (
                  <ul style={{ margin: 0, paddingLeft: "1.25rem", color: "#78350f", fontSize: 14 }}>
                    {prepared.gaps.map((gap, i) => (
                      <li key={i}>{gap}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Match reasoning panel */}
            {parsedEvidence.length > 0 && (
              <div style={{ marginBottom: "1.5rem" }}>
                <button
                  onClick={() => setShowEvidence((v) => !v)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#374151",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.4rem",
                    marginBottom: "0.5rem",
                  }}
                >
                  <span>{showEvidence ? "▾" : "▸"}</span>
                  Match Breakdown
                  <span style={{ fontWeight: 400, fontSize: 13, color: "#6b7280", marginLeft: "0.25rem" }}>
                    ({parsedEvidence.filter((e) => e.rating === "STRONG").length} strong ·{" "}
                    {parsedEvidence.filter((e) => e.rating === "MODERATE").length} moderate ·{" "}
                    {parsedEvidence.filter((e) => e.rating === "WEAK").length} weak)
                  </span>
                </button>
                {showEvidence && (
                  <div
                    style={{
                      border: "1px solid #e5e7eb",
                      borderRadius: 6,
                      overflow: "hidden",
                    }}
                  >
                    {parsedEvidence.map((item, i) => {
                      const colors = {
                        STRONG: { bg: "#f0fdf4", badge: "#16a34a", text: "#15803d" },
                        MODERATE: { bg: "#fffbeb", badge: "#d97706", text: "#92400e" },
                        WEAK: { bg: "#fef2f2", badge: "#dc2626", text: "#991b1b" },
                      }[item.rating];
                      return (
                        <div
                          key={i}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "80px 1fr 1.2fr",
                            gap: "0.75rem",
                            alignItems: "start",
                            padding: "0.6rem 0.75rem",
                            background: i % 2 === 0 ? "#fff" : "#f9fafb",
                            borderTop: i > 0 ? "1px solid #f3f4f6" : "none",
                            fontSize: 13,
                          }}
                        >
                          <span
                            style={{
                              display: "inline-block",
                              padding: "2px 8px",
                              borderRadius: 99,
                              background: colors.bg,
                              color: colors.badge,
                              border: `1px solid ${colors.badge}`,
                              fontWeight: 600,
                              fontSize: 11,
                              textAlign: "center",
                            }}
                          >
                            {item.rating}
                          </span>
                          <span style={{ color: "#111827", lineHeight: 1.4 }}>{item.requirement}</span>
                          <span style={{ color: "#6b7280", lineHeight: 1.4 }}>{item.evidence}</span>
                        </div>
                      );
                    })}
                    {prepared?.gaps && prepared.gaps.length > 0 && (
                      <div
                        style={{
                          padding: "0.6rem 0.75rem",
                          background: "#fef2f2",
                          borderTop: "1px solid #fecaca",
                          fontSize: 13,
                        }}
                      >
                        <span style={{ fontWeight: 600, color: "#991b1b" }}>Missing: </span>
                        <span style={{ color: "#7f1d1d" }}>{prepared.gaps.join(" · ")}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Cover letter + JD side by side */}
            <div style={{ display: "flex", gap: "1.5rem", marginBottom: "1.5rem" }}>
              {/* Left: cover letter */}
              <div style={{ flex: 1, minWidth: 0 }}>
                {prepared.is_suitable !== false ? (
                  <>
                    <h3 style={{ marginTop: 0 }}>Cover Letter</h3>
                    <textarea
                      value={coverLetterText}
                      onChange={(e) => setCoverLetterText(e.target.value)}
                      rows={20}
                      style={{
                        width: "100%",
                        padding: "0.75rem",
                        border: "1px solid #d1d5db",
                        borderRadius: 6,
                        fontFamily: "inherit",
                        fontSize: 13,
                        resize: "vertical",
                        whiteSpace: "pre-wrap",
                        boxSizing: "border-box",
                      }}
                    />
                  </>
                ) : (
                  <p style={{ color: "#6b7280", fontSize: 14 }}>No cover letter generated — profile did not match.</p>
                )}
              </div>

              {/* Right: job description */}
              {prepared.job_description && (
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ marginTop: 0 }}>Job Description</h3>
                  <div
                    style={{
                      padding: "0.75rem",
                      background: "#f9fafb",
                      border: "1px solid #e5e7eb",
                      borderRadius: 6,
                      fontSize: 13,
                      color: "#374151",
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap",
                      overflowY: "auto",
                      maxHeight: "480px",
                    }}
                  >
                    {prepared.job_description}
                  </div>
                </div>
              )}
            </div>

            {/* Interview questions — on demand */}
            {applicationId && !actionDone && (
              <section style={{ marginBottom: "1.5rem" }}>
                {questions.length === 0 ? (
                  <button
                    onClick={() => questionsMutation.mutate(applicationId)}
                    disabled={questionsMutation.isPending}
                    style={{
                      padding: "0.5rem 1.25rem",
                      background: "#f3f4f6",
                      color: "#374151",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      cursor: questionsMutation.isPending ? "not-allowed" : "pointer",
                      fontSize: 14,
                    }}
                  >
                    {questionsMutation.isPending ? "Generating questions…" : "Prepare Interview Questions"}
                  </button>
                ) : (
                  <>
                    <h3>Predicted Interview Questions</h3>
                    {questions.map((qa, i) => (
                      <div
                        key={i}
                        style={{
                          marginBottom: "1rem",
                          padding: "0.75rem",
                          background: "#f9fafb",
                          border: "1px solid #e5e7eb",
                          borderRadius: 6,
                        }}
                      >
                        <p style={{ fontWeight: 600, margin: "0 0 0.5rem" }}>Q{i + 1}: {qa.question}</p>
                        <p style={{ margin: 0, color: "#374151" }}>{qa.answer}</p>
                      </div>
                    ))}
                  </>
                )}
                {questionsMutation.isError && (
                  <p style={{ color: "red", marginTop: 8 }}>
                    {questionsMutation.error instanceof Error ? questionsMutation.error.message : "Unknown error"}
                  </p>
                )}
              </section>
            )}

            {/* Action buttons */}
            {!actionDone && !applyState && applicationId && (
              <div style={{ display: "flex", gap: "0.75rem" }}>
                {prepared.is_suitable !== false && (
                  <button
                    onClick={() => approveMutation.mutate(applicationId)}
                    disabled={approveMutation.isPending}
                    style={{
                      padding: "0.5rem 1.25rem",
                      background: "#16a34a",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                  >
                    Approve
                  </button>
                )}
                <button
                  onClick={() => discardMutation.mutate({ appId: applicationId, jobId: selectedJob.id })}
                  disabled={discardMutation.isPending}
                  style={{
                    padding: "0.5rem 1.25rem",
                    background: "#dc2626",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  Discard
                </button>
              </div>
            )}

            {/* Start apply */}
            {actionDone === "approved" && !applyState && applicationId && (
              <div style={{ marginTop: "1rem" }}>
                <button
                  onClick={() => applyMutation.mutate(applicationId)}
                  disabled={applyMutation.isPending}
                  style={{
                    padding: "0.5rem 1.25rem",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: applyMutation.isPending ? "not-allowed" : "pointer",
                    fontSize: 14,
                  }}
                >
                  {applyMutation.isPending ? "Filling form… (this may take a minute)" : "Start Applying on SEEK"}
                </button>
                {applyMutation.isError && (
                  <p style={{ color: "red", marginTop: 8 }}>
                    {applyMutation.error instanceof Error ? applyMutation.error.message : "Unknown error"}
                  </p>
                )}
              </div>
            )}

            {/* Apply workflow failed */}
            {applyState?.status === "failed" && applicationId && (
              <div
                style={{
                  marginTop: "1rem",
                  padding: "1.25rem",
                  background: "#fef2f2",
                  border: "1px solid #fca5a5",
                  borderRadius: 6,
                }}
              >
                <p style={{ fontWeight: 600, margin: "0 0 0.5rem", color: "#991b1b" }}>
                  Apply workflow failed
                </p>
                <p style={{ margin: "0 0 1rem", color: "#7f1d1d", fontSize: 14 }}>
                  Something went wrong during the automated application. You can retry by re-approving, or discard this job.
                </p>
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    onClick={() => approveMutation.mutate(applicationId)}
                    disabled={approveMutation.isPending}
                    style={{
                      padding: "0.5rem 1.25rem",
                      background: "#2563eb",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                  >
                    Back to Queue
                  </button>
                  <button
                    onClick={() => discardMutation.mutate({ appId: applicationId, jobId: selectedJob.id })}
                    disabled={discardMutation.isPending}
                    style={{
                      padding: "0.5rem 1.25rem",
                      background: "#fff",
                      color: "#dc2626",
                      border: "1px solid #dc2626",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}

            {/* External portal redirect */}
            {applyState?.status === "paused" && applyState.step?.page_type === "external_redirect" && applicationId && (
              <div
                style={{
                  marginTop: "1rem",
                  padding: "1.25rem",
                  background: "#fffbeb",
                  border: "1px solid #d97706",
                  borderRadius: 6,
                }}
              >
                <p style={{ fontWeight: 600, margin: "0 0 0.5rem", color: "#92400e", fontSize: 15 }}>
                  External application portal
                  {applyState.step.portal_type && applyState.step.portal_type !== "unknown" && (
                    <span style={{
                      marginLeft: "0.5rem",
                      padding: "2px 8px",
                      background: "#fef3c7",
                      border: "1px solid #d97706",
                      borderRadius: 99,
                      fontSize: 12,
                      textTransform: "capitalize",
                    }}>
                      {applyState.step.portal_type}
                    </span>
                  )}
                </p>
                <p style={{ margin: "0 0 1rem", color: "#78350f", fontSize: 14 }}>
                  This job applies through an external portal. Open the link below, complete the
                  application there, then click <strong>Mark as Submitted</strong> to record it.
                </p>
                {applyState.step.page_url && (
                  <a
                    href={applyState.step.page_url}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: "inline-block",
                      marginBottom: "1rem",
                      fontSize: 13,
                      color: "#1d4ed8",
                      wordBreak: "break-all",
                    }}
                  >
                    {applyState.step.page_url} ↗
                  </a>
                )}
                <div style={{ display: "flex", gap: "0.75rem" }}>
                  <button
                    onClick={() => markSubmittedMutation.mutate(applicationId)}
                    disabled={markSubmittedMutation.isPending}
                    style={{
                      padding: "0.5rem 1.25rem",
                      background: "#16a34a",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      cursor: markSubmittedMutation.isPending ? "not-allowed" : "pointer",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {markSubmittedMutation.isPending ? "Saving…" : "Mark as Submitted"}
                  </button>
                  <button
                    onClick={() => discardMutation.mutate({ appId: applicationId, jobId: selectedJob.id })}
                    disabled={discardMutation.isPending}
                    style={{
                      padding: "0.5rem 1.25rem",
                      background: "#fff",
                      color: "#dc2626",
                      border: "1px solid #dc2626",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                  >
                    Discard
                  </button>
                </div>
                {markSubmittedMutation.isError && (
                  <p style={{ color: "red", marginTop: 8, fontSize: 13 }}>
                    {markSubmittedMutation.error instanceof Error ? markSubmittedMutation.error.message : "Unknown error"}
                  </p>
                )}
              </div>
            )}

            {/* Pre-submit review */}
            {applyState?.status === "awaiting_submit" && (
              <div style={{ marginTop: "1.5rem" }}>
                <h3 style={{ margin: "0 0 1rem" }}>Review Filled Answers</h3>
                {applyState.step_history.map((entry, si) => {
                  const fields: Array<{ id: string; label: string }> = entry.step.fields ?? [];
                  const filled: Record<string, string> = entry.filled_values ?? {};
                  const rows = fields.filter((f) => filled[f.id] !== undefined);
                  if (rows.length === 0) return null;
                  return (
                    <div key={si} style={{ marginBottom: "1rem" }}>
                      <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: "0.25rem" }}>Step {si + 1}</div>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                        <tbody>
                          {rows.map((f) => (
                            <tr key={f.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                              <td style={{ padding: "0.35rem 0.5rem", color: "#6b7280", width: "40%" }}>{f.label}</td>
                              <td style={{ padding: "0.35rem 0.5rem", wordBreak: "break-word" }}>{filled[f.id]}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
                <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
                  <button
                    onClick={() => submitMutation.mutate({
                      runId: applyState.workflow_run_id,
                      label: applyState.submit_action_label ?? "Continue",
                    })}
                    disabled={submitMutation.isPending}
                    style={{
                      padding: "0.5rem 1.5rem",
                      background: "#16a34a",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      cursor: submitMutation.isPending ? "not-allowed" : "pointer",
                      fontSize: 14,
                      fontWeight: 600,
                    }}
                  >
                    {submitMutation.isPending ? "Submitting…" : "Submit to SEEK"}
                  </button>
                  <button
                    onClick={() => setApplyState(null)}
                    style={{
                      padding: "0.5rem 1.25rem",
                      background: "#f3f4f6",
                      color: "#374151",
                      border: "1px solid #d1d5db",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 14,
                    }}
                  >
                    Cancel
                  </button>
                </div>
                {submitMutation.isError && (
                  <p style={{ color: "red", marginTop: 8 }}>
                    {submitMutation.error instanceof Error ? submitMutation.error.message : "Unknown error"}
                  </p>
                )}
              </div>
            )}

            {applyState?.status === "completed" && (
              <p style={{ fontWeight: 600, color: "#16a34a", marginTop: "1rem" }}>
                Application submitted to SEEK.
              </p>
            )}

            {actionDone === "discarded" && (
              <p style={{ fontWeight: 600, color: "#dc2626" }}>Job discarded and removed from review.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
