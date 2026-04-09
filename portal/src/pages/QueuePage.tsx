import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApplications, fetchApplicationDetail, discardApplication } from "../api/applications";
import type { Application } from "../api/schemas";

const STATE_COLOURS: Record<string, string> = {
  prepared: "#d97706",
  approved: "#2563eb",
  discarded: "#6b7280",
  submitted: "#16a34a",
};

export default function QueuePage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Application | null>(null);

  const appsQuery = useQuery({
    queryKey: ["applications", "approved"],
    queryFn: () => fetchApplications("approved"),
  });

  const detailQuery = useQuery({
    queryKey: ["application-detail", selected?.id],
    queryFn: () => fetchApplicationDetail(selected!.id),
    enabled: !!selected,
  });

  const discardMutation = useMutation({
    mutationFn: (appId: string) => discardApplication(appId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["applications"] });
      setSelected(null);
    },
  });

  const coverLetter = detailQuery.data?.drafts.find((d) => d.draft_type === "cover_letter");
  const qaDrafts = detailQuery.data?.drafts.filter((d) => d.draft_type === "question_answer") ?? [];

  return (
    <div style={{ display: "flex", gap: "1.5rem" }}>
      {/* Approved applications list */}
      <div style={{ width: 300, flexShrink: 0 }}>
        <h2 style={{ marginTop: 0 }}>Approved ({appsQuery.data?.length ?? 0})</h2>
        {appsQuery.isLoading && <p>Loading…</p>}
        {appsQuery.data?.length === 0 && (
          <p style={{ color: "#6b7280", fontSize: 14 }}>
            No approved applications yet. Prepare and approve jobs from the Review Desk.
          </p>
        )}
        {appsQuery.data?.map((app) => (
          <div
            key={app.id}
            onClick={() => setSelected(app)}
            style={{
              padding: "0.75rem",
              marginBottom: "0.5rem",
              border: selected?.id === app.id ? "2px solid #2563eb" : "1px solid #e5e7eb",
              borderRadius: 6,
              cursor: "pointer",
              background: selected?.id === app.id ? "#eff6ff" : "#fff",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>{app.job_title ?? "Unknown job"}</div>
            <div style={{ color: "#6b7280", fontSize: 13 }}>{app.job_company}</div>
            {app.job_location && (
              <div style={{ color: "#9ca3af", fontSize: 12 }}>{app.job_location}</div>
            )}
            <div style={{ marginTop: 4 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: STATE_COLOURS[app.state] ?? "#374151",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {app.state}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1 }}>
        {!selected && (
          <p style={{ color: "#6b7280" }}>Select an application to review its drafts.</p>
        )}

        {selected && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ marginTop: 0 }}>
                  {selected.job_title} — {selected.job_company}
                </h2>
                {selected.job_location && (
                  <p style={{ color: "#6b7280", margin: "0 0 0.5rem" }}>{selected.job_location}</p>
                )}
                {selected.job_source_url && (
                  <a href={selected.job_source_url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                    View on SEEK ↗
                  </a>
                )}
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <button
                  onClick={() => navigate(`/apply/${selected.id}`)}
                  style={{
                    padding: "0.4rem 1rem",
                    background: "#2563eb",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Apply
                </button>
                <button
                  onClick={() => discardMutation.mutate(selected.id)}
                  disabled={discardMutation.isPending}
                  style={{
                    padding: "0.4rem 1rem",
                    background: "#dc2626",
                    color: "#fff",
                    border: "none",
                    borderRadius: 6,
                    cursor: "pointer",
                    fontSize: 13,
                  }}
                >
                  Discard
                </button>
              </div>
            </div>

            {selected.job_summary && (
              <div
                style={{
                  margin: "1rem 0",
                  padding: "0.75rem",
                  background: "#f9fafb",
                  border: "1px solid #e5e7eb",
                  borderRadius: 6,
                  fontSize: 14,
                  color: "#374151",
                }}
              >
                {selected.job_summary}
              </div>
            )}

            {detailQuery.isLoading && <p>Loading drafts…</p>}

            {coverLetter && (
              <section style={{ marginBottom: "1.5rem" }}>
                <h3>Cover Letter</h3>
                <textarea
                  defaultValue={coverLetter.content}
                  rows={12}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #d1d5db",
                    borderRadius: 6,
                    fontFamily: "inherit",
                    fontSize: 14,
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                />
              </section>
            )}

            {qaDrafts.length > 0 && (
              <section>
                <h3>Predicted Interview Questions</h3>
                {qaDrafts.map((draft, i) => {
                  let qa: { question: string; answer: string } = { question: "", answer: "" };
                  try { qa = JSON.parse(draft.content); } catch { /* ignore */ }
                  return (
                    <div
                      key={draft.id}
                      style={{
                        marginBottom: "1rem",
                        padding: "0.75rem",
                        background: "#f9fafb",
                        border: "1px solid #e5e7eb",
                        borderRadius: 6,
                      }}
                    >
                      <p style={{ fontWeight: 600, margin: "0 0 0.5rem" }}>
                        Q{i + 1}: {qa.question}
                      </p>
                      <p style={{ margin: 0, color: "#374151" }}>{qa.answer}</p>
                    </div>
                  );
                })}
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
