import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { apiFetch } from "@/api/client";
import {
  profileTargetResponseSchema,
  profileUploadResponseSchema,
  rawProfileResponseSchema,
  setupStatusSchema,
  type CanonicalProfile,
  type ProfileAnswer,
  type ProfileTargetResponse,
  type ProfileUploadResponse,
  type RawProfile,
  type RawProfileResponse,
  type SetupStatus,
} from "@/api/schemas";
import { z } from "zod";

async function fetchSetupStatus(): Promise<SetupStatus> {
  const raw = await apiFetch<unknown>("/setup/status");
  return setupStatusSchema.parse(raw);
}

async function openProviderLogin(provider: string) {
  const raw = await apiFetch<unknown>(`/setup/login/${provider}`, { method: "POST" });
  return z.object({ ok: z.boolean(), error: z.string().optional() }).parse(raw);
}

async function fetchProfileTarget(): Promise<ProfileTargetResponse> {
  const raw = await apiFetch<unknown>("/setup/profile/target");
  return profileTargetResponseSchema.parse(raw);
}

async function fetchRawProfile(): Promise<RawProfileResponse> {
  const raw = await apiFetch<unknown>("/setup/profile/raw");
  return rawProfileResponseSchema.parse(raw);
}

async function saveProfileTarget(targetProfile: CanonicalProfile) {
  const raw = await apiFetch<unknown>("/setup/profile/target", {
    method: "POST",
    body: JSON.stringify({ target_profile: targetProfile }),
  });
  return z.object({ ok: z.boolean(), target_profile_path: z.string() }).parse(raw);
}

async function saveProfileAnswers(answers: ProfileAnswer[]): Promise<ProfileTargetResponse> {
  const raw = await apiFetch<unknown>("/setup/profile/target/answers", {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
  return profileTargetResponseSchema.parse(raw);
}

async function uploadProfileFile(file: File): Promise<ProfileUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const raw = await apiFetch<unknown>("/setup/profile/upload", {
    method: "POST",
    body: formData,
  });
  return profileUploadResponseSchema.parse(raw);
}

const PROVIDER_LABELS: Record<string, string> = {
  seek: "SEEK",
  linkedin: "LinkedIn",
};

function SectionHeader({ title }: { title: string }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
      {title}
    </p>
  );
}

function RawProfilePreview({ rawProfile }: { rawProfile: RawProfile }) {
  return (
    <div className="space-y-3">
      <div className="rounded border bg-slate-50 p-3">
        <p className="text-sm font-medium text-slate-800">
          {rawProfile.identity.name || "Unnamed candidate"}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          {[rawProfile.identity.headline, rawProfile.identity.email, rawProfile.identity.location]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {rawProfile.summary && (
          <p className="mt-2 text-xs text-slate-600 leading-5">{rawProfile.summary}</p>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded border bg-white p-3">
          <SectionHeader title="Experience" />
          <div className="mt-2 space-y-3">
            {rawProfile.experience.slice(0, 3).map((item) => (
              <div key={item.id}>
                <p className="text-sm font-medium text-slate-800">
                  {[item.title, item.company].filter(Boolean).join(" at ") || "Experience item"}
                </p>
                {item.period_raw && (
                  <p className="text-[11px] text-slate-400 mt-0.5">{item.period_raw}</p>
                )}
                {item.bullets.length > 0 && (
                  <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-600">
                    {item.bullets.slice(0, 3).map((bullet, index) => (
                      <li key={`${item.id}-${index}`}>{bullet.text}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {rawProfile.experience.length === 0 && (
              <p className="text-xs text-slate-400">No experience entries extracted yet.</p>
            )}
          </div>
        </div>

        <div className="rounded border bg-white p-3 space-y-3">
          <div>
            <SectionHeader title="Skills" />
            <div className="mt-2 flex flex-wrap gap-1.5">
              {rawProfile.skills.slice(0, 12).map((skill) => (
                <span key={skill} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  {skill}
                </span>
              ))}
              {rawProfile.skills.length === 0 && (
                <p className="text-xs text-slate-400">No skills section extracted yet.</p>
              )}
            </div>
          </div>

          <div>
            <SectionHeader title="Projects" />
            <div className="mt-2 space-y-2">
              {rawProfile.projects.slice(0, 2).map((project) => (
                <div key={project.id}>
                  <p className="text-sm font-medium text-slate-800">{project.name || "Project"}</p>
                  {project.summary && (
                    <p className="mt-1 text-xs text-slate-600">{project.summary}</p>
                  )}
                </div>
              ))}
              {rawProfile.projects.length === 0 && (
                <p className="text-xs text-slate-400">No project entries extracted yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {rawProfile.parse_notes.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3">
          <SectionHeader title="Parse Notes" />
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-amber-900">
            {rawProfile.parse_notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function SetupPage() {
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});

  const statusQuery = useQuery({
    queryKey: ["setup-status"],
    queryFn: fetchSetupStatus,
    refetchInterval: 5000,
  });

  const rawProfileQuery = useQuery({
    queryKey: ["setup-profile-raw"],
    queryFn: fetchRawProfile,
    refetchInterval: 5000,
  });

  const loginMutation = useMutation({
    mutationFn: openProviderLogin,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["setup-status"] }),
  });

  const uploadMutation = useMutation({
    mutationFn: uploadProfileFile,
    onSuccess: async () => {
      setSelectedFile(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["setup-status"] }),
        queryClient.invalidateQueries({ queryKey: ["setup-profile-raw"] }),
        queryClient.invalidateQueries({ queryKey: ["setup-profile-target"] }),
      ]);
    },
  });

  const targetQuery = useQuery({
    queryKey: ["setup-profile-target"],
    queryFn: fetchProfileTarget,
    refetchInterval: 5000,
  });

  const saveTargetMutation = useMutation({
    mutationFn: saveProfileTarget,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["setup-status"] });
      queryClient.invalidateQueries({ queryKey: ["setup-profile-target"] });
    },
  });

  const saveAnswersMutation = useMutation({
    mutationFn: saveProfileAnswers,
    onSuccess: async (data) => {
      setQuestionDrafts(
        Object.fromEntries(
          (data.questions ?? []).map((question) => [question.id, question.current_value ?? ""]),
        ),
      );
      queryClient.setQueryData(["setup-profile-target"], data);
      await queryClient.invalidateQueries({ queryKey: ["setup-status"] });
    },
  });

  const status = statusQuery.data;
  const rawProfile = rawProfileQuery.data;
  const target = targetQuery.data;
  const hasProfileSource = Boolean(status?.raw_profile_exists || status?.profile_json_exists);
  const allDone = hasProfileSource && status?.target_profile_exists && status?.chrome_has_cookies;

  useEffect(() => {
    if (!target?.questions?.length) {
      return;
    }
    setQuestionDrafts((current) => {
      const next = { ...current };
      let changed = false;
      for (const question of target.questions) {
        if (next[question.id] === undefined) {
          next[question.id] = question.current_value ?? "";
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [target?.questions]);

  const questionAnswersToSave: ProfileAnswer[] = (target?.questions ?? []).map((question) => ({
    question_id: question.id,
    target_field: question.target_field,
    value: questionDrafts[question.id] ?? question.current_value ?? "",
  }));

  const hasQuestionChanges = (target?.questions ?? []).some((question) => {
    const draftValue = questionDrafts[question.id] ?? question.current_value ?? "";
    return draftValue !== (question.current_value ?? "");
  });

  return (
    <section className="space-y-6 max-w-5xl">
      <header>
        <h1 className="text-2xl font-semibold">Setup</h1>
        <p className="text-slate-500 text-sm mt-1">
          Upload a source profile, review the parsed raw profile, and then shape the STAR-style target profile the agent should eventually write from.
        </p>
      </header>

      {statusQuery.isLoading && <p className="text-slate-400 text-sm">Checking…</p>}

      {status && (
        <>
          <div className="rounded-lg border bg-white divide-y">
            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className={`text-base font-semibold ${hasProfileSource ? "text-green-600" : "text-slate-800"}`}>
                  1. Upload your source profile
                </span>
                {hasProfileSource && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Done</span>
                )}
              </div>

              <p className="text-sm text-slate-500">
                Upload a resume or profile file in <strong>PDF</strong>, <strong>DOCX</strong>, or <strong>JSON</strong>. Envoy stores the original file, extracts a raw profile artifact, and uses that to build the canonical target profile.
              </p>

              <div className="rounded border bg-slate-50 p-3 space-y-3">
                <input
                  type="file"
                  accept=".pdf,.docx,.json,application/pdf,application/json,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-slate-700 file:mr-4 file:rounded file:border-0 file:bg-blue-600 file:px-3 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-blue-700"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => selectedFile && uploadMutation.mutate(selectedFile)}
                    disabled={!selectedFile || uploadMutation.isPending}
                    className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {uploadMutation.isPending ? "Uploading…" : "Upload and parse"}
                  </button>
                  {selectedFile && (
                    <span className="text-xs text-slate-500">{selectedFile.name}</span>
                  )}
                </div>
              </div>

              <div className="grid gap-2 text-xs text-slate-500 sm:grid-cols-2">
                <div className="rounded border bg-white px-3 py-2">
                  Raw profile path: <span className="font-mono text-slate-700">{status.raw_profile_path}</span>
                </div>
                <div className="rounded border bg-white px-3 py-2">
                  Latest upload: <span className="font-mono text-slate-700">{status.latest_uploaded_filename || "None yet"}</span>
                </div>
              </div>

              {status.profile_json_exists && (
                <p className="text-xs text-slate-400">
                  Legacy JSON profile still exists at <span className="font-mono">{status.profile_json_path}</span>. Until later phases switch generation to canonical profile only, the main application workflows still read that configured JSON profile.
                </p>
              )}

              {uploadMutation.isSuccess && (
                <div className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                  Uploaded <strong>{uploadMutation.data.source_document.filename}</strong> and saved raw profile to <span className="font-mono">{uploadMutation.data.raw_profile_path}</span>.
                </div>
              )}
              {uploadMutation.isError && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {(uploadMutation.error as Error).message}
                </div>
              )}
            </div>

            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className={`text-base font-semibold ${status.raw_profile_exists ? "text-green-600" : "text-slate-800"}`}>
                  2. Review parsed raw profile
                </span>
                {status.raw_profile_exists && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Ready</span>
                )}
              </div>

              <p className="text-sm text-slate-500">
                This is the non-canonical parsed profile derived from your upload. It stays close to the source material so we can preserve traceability before turning it into STAR-style evidence.
              </p>

              {rawProfileQuery.isLoading && <p className="text-xs text-slate-400">Loading raw profile…</p>}

              {rawProfile?.raw_profile ? (
                <>
                  <p className="text-xs text-slate-400 font-mono">{rawProfile.raw_profile_path}</p>
                  <RawProfilePreview rawProfile={rawProfile.raw_profile} />
                </>
              ) : (
                <p className="text-xs text-slate-400">
                  Upload a source profile to generate a raw profile artifact.
                </p>
              )}
            </div>

            <div className="p-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className={`text-base font-semibold ${status.target_profile_exists ? "text-green-600" : "text-slate-800"}`}>
                  3. Build your target profile
                </span>
                {status.target_profile_exists && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Done</span>
                )}
              </div>

              <p className="text-sm text-slate-500">
                This is the canonical STAR-style profile draft the agent will eventually write from. It is generated from the raw profile when available, otherwise from the existing JSON profile.
              </p>

              {!hasProfileSource && (
                <p className="text-xs text-slate-400">
                  Upload a source profile first, or keep using the existing JSON profile, then Envoy can generate a canonical target profile draft.
                </p>
              )}

              {hasProfileSource && targetQuery.isLoading && (
                <p className="text-xs text-slate-400">Generating target profile draft…</p>
              )}

              {hasProfileSource && target?.target_profile && (
                <div className="space-y-3">
                  <p className="text-xs text-slate-400 font-mono">
                    {status.target_profile_exists ? status.target_profile_path : `Draft path: ${target.target_profile_path}`}
                  </p>

                  <div className="rounded border bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-slate-800">
                          {target.target_profile.name || "Unnamed profile"}
                        </p>
                        {target.target_profile.headline && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            {target.target_profile.headline}
                          </p>
                        )}
                      </div>
                      {!status.target_profile_exists && (
                        <button
                          onClick={() => saveTargetMutation.mutate(target.target_profile as CanonicalProfile)}
                          disabled={saveTargetMutation.isPending}
                          className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {saveTargetMutation.isPending ? "Saving…" : "Save draft"}
                        </button>
                      )}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div className="rounded border bg-white px-2 py-1.5">
                        Evidence items: {target.target_profile.evidence_items.length}
                      </div>
                      <div className="rounded border bg-white px-2 py-1.5">
                        Voice samples: {target.target_profile.voice_samples.length}
                      </div>
                    </div>
                  </div>

                  {target.target_profile.evidence_items.length > 0 && (
                    <div className="space-y-2">
                      <SectionHeader title="Evidence Preview" />
                      {target.target_profile.evidence_items.slice(0, 4).map((item) => (
                        <div key={item.id} className="rounded border bg-white p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-slate-800">
                              {item.source}
                              {item.role_title ? ` · ${item.role_title}` : ""}
                            </p>
                            <span className="text-[11px] uppercase tracking-wide text-slate-400">
                              {item.confidence}
                            </span>
                          </div>
                          {item.action && (
                            <p className="mt-1 text-xs text-slate-600">{item.action}</p>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {item.skills.slice(0, 4).map((skill) => (
                              <span key={skill} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                                {skill}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {target.questions.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <SectionHeader title="Enrichment Questions" />
                        <button
                          onClick={() => saveAnswersMutation.mutate(questionAnswersToSave)}
                          disabled={!hasQuestionChanges || saveAnswersMutation.isPending}
                          className="rounded bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {saveAnswersMutation.isPending ? "Saving answers…" : "Save answers"}
                        </button>
                      </div>
                      {target.questions.slice(0, 6).map((question) => (
                        <div key={question.id} className="rounded border bg-amber-50 border-amber-200 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-medium text-amber-900">{question.prompt}</p>
                            <span className="text-[11px] uppercase tracking-wide text-amber-700">
                              {question.priority}
                            </span>
                          </div>
                          {question.help_text && (
                            <p className="mt-1 text-xs text-amber-800">{question.help_text}</p>
                          )}
                          <textarea
                            value={questionDrafts[question.id] ?? question.current_value ?? ""}
                            onChange={(event) =>
                              setQuestionDrafts((current) => ({
                                ...current,
                                [question.id]: event.target.value,
                              }))
                            }
                            rows={question.input_type === "textarea" ? 4 : 2}
                            className="mt-3 w-full rounded border border-amber-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-200"
                            placeholder="Type your answer here"
                          />
                          {question.current_value && (
                            <p className="mt-2 text-[11px] text-amber-700">
                              Current value is prefilled. Edit it if you want to sharpen or replace it.
                            </p>
                          )}
                        </div>
                      ))}
                      {saveAnswersMutation.isSuccess && (
                        <p className="text-sm text-green-700">
                          Answers saved. The canonical draft and remaining questions have been refreshed.
                        </p>
                      )}
                      {saveAnswersMutation.isError && (
                        <p className="text-sm text-red-600">
                          {(saveAnswersMutation.error as Error).message}
                        </p>
                      )}
                    </div>
                  )}

                  {saveTargetMutation.isSuccess && (
                    <p className="text-sm text-green-700">
                      Target profile saved. You can now refine this file or use it as the basis for the next onboarding step.
                    </p>
                  )}
                  {saveTargetMutation.isError && (
                    <p className="text-sm text-red-600">
                      {(saveTargetMutation.error as Error).message}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-base font-semibold ${status.chrome_has_cookies ? "text-green-600" : "text-slate-800"}`}>
                  4. Log in to job providers
                </span>
                {status.chrome_has_cookies && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Done</span>
                )}
              </div>
              <p className="text-sm text-slate-500 mb-3">
                Envoy uses a <strong>dedicated browser profile</strong>, separate from your personal Chrome, so it only has access to the accounts you log in to here.
              </p>

              {status.chrome_profile_dir && (
                <p className="text-xs text-slate-400 font-mono mb-3">
                  Profile: {status.chrome_profile_dir}
                </p>
              )}

              <div className="space-y-2">
                {status.providers.map((provider) => (
                  <div key={provider} className="flex items-center justify-between gap-3 p-3 rounded border bg-slate-50">
                    <span className="text-sm font-medium text-slate-700">
                      {PROVIDER_LABELS[provider] ?? provider}
                    </span>
                    <button
                      onClick={() => loginMutation.mutate(provider)}
                      disabled={loginMutation.isPending && loginMutation.variables === provider}
                      className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {loginMutation.isPending && loginMutation.variables === provider
                        ? "Opening…"
                        : "Open login page"}
                    </button>
                  </div>
                ))}
              </div>

              {loginMutation.isSuccess && (
                <p className="mt-3 text-sm text-slate-500">
                  Chrome opened. Log in, then come back here. This page refreshes automatically.
                </p>
              )}
              {loginMutation.isError && (
                <p className="mt-2 text-sm text-red-600">{(loginMutation.error as Error).message}</p>
              )}
            </div>
          </div>

          {allDone && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800">
              <strong>You're all set.</strong> Head to <strong>Jobs</strong> to run your first search.
            </div>
          )}
        </>
      )}
    </section>
  );
}
