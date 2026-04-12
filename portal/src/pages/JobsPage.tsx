import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJobs, ignoreJob, queueJob, runSearch } from "@/api/jobs";
import { useState } from "react";

export default function JobsPage() {
  const queryClient = useQueryClient();
  const [keywords, setKeywords] = useState("python");
  const [location, setLocation] = useState("");

  const jobsQuery = useQuery({
    queryKey: ["jobs", "discovered"],
    queryFn: () => fetchJobs({ state: "discovered" }),
  });

  const searchMutation = useMutation({
    mutationFn: runSearch,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const queueMutation = useMutation({
    mutationFn: queueJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const ignoreMutation = useMutation({
    mutationFn: ignoreJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Jobs</h1>
      </header>

      <form
        className="flex flex-wrap items-end gap-3 rounded-md border bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          searchMutation.mutate({ provider: "seek", keywords, location: location || undefined });
        }}
      >
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-600">Keywords</span>
          <input
            className="rounded border px-2 py-1"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-600">Location (optional)</span>
          <input
            className="rounded border px-2 py-1"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <button
          type="submit"
          disabled={searchMutation.isPending}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {searchMutation.isPending ? "Searching…" : "Run search"}
        </button>
        {searchMutation.isSuccess && (
          <span className="text-sm text-slate-500">
            {searchMutation.data.persisted} new, {searchMutation.data.blocked} blocked
          </span>
        )}
        {searchMutation.isError && (
          <span className="text-sm text-red-600">{(searchMutation.error as Error).message}</span>
        )}
      </form>

      {jobsQuery.isLoading && <p className="text-slate-500">Loading…</p>}
      {jobsQuery.isError && (
        <p className="text-red-600">Failed to load jobs: {(jobsQuery.error as Error).message}</p>
      )}
      {jobsQuery.isSuccess && jobsQuery.data.length === 0 && (
        <p className="text-slate-500">No new jobs. Run a search to discover some.</p>
      )}

      {jobsQuery.isSuccess && jobsQuery.data.length > 0 && (
        <div className="overflow-hidden rounded-md border bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Company</th>
                <th className="px-3 py-2">Location</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobsQuery.data.map((job) => (
                <tr key={job.id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <a
                      href={job.source_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {job.title}
                    </a>
                  </td>
                  <td className="px-3 py-2 text-slate-700">{job.company}</td>
                  <td className="px-3 py-2 text-slate-500">{job.location ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => queueMutation.mutate(job.id)}
                        disabled={queueMutation.isPending}
                        className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        Review
                      </button>
                      <button
                        onClick={() => ignoreMutation.mutate(job.id)}
                        disabled={ignoreMutation.isPending}
                        className="rounded border px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                      >
                        Ignore
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
