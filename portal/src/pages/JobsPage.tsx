import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJobs, fetchSearchTags, ignoreJob, queueJob, runSearch } from "@/api/jobs";
import { useState } from "react";
import type { Job } from "@/api/schemas";

function postedAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function JobCard({ job, onReview, onIgnore, isPending, onTagClick }: {
  job: Job;
  onReview: () => void;
  onIgnore: () => void;
  isPending: boolean;
  onTagClick: (tag: string) => void;
}) {
  const meta = job.payload;
  const providerTags = meta.tags ?? [];
  const bullets = meta.bullet_points ?? [];
  const searchTags = job.search_tags ?? [];

  const chips: string[] = [];
  if (meta.work_type) chips.push(meta.work_type);
  if (job.location) chips.push(job.location);
  if (meta.work_arrangement) chips.push(meta.work_arrangement);
  if (meta.salary) chips.push(meta.salary);

  return (
    <div className="flex gap-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 hover:shadow-sm transition-shadow">
      <div className="flex-shrink-0 w-12 h-12 rounded border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 flex items-center justify-center overflow-hidden">
        {meta.logo_url ? (
          <img
            src={meta.logo_url}
            alt={job.company}
            className="w-full h-full object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
        ) : (
          <span className="text-slate-400 dark:text-slate-500 text-xs font-medium text-center leading-tight px-1">
            {job.company.substring(0, 2).toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-2 flex-wrap mb-0.5">
          <a
            href={job.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 dark:text-blue-400 font-semibold hover:underline text-sm leading-snug"
          >
            {job.title}
          </a>
          {providerTags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300 font-medium flex-shrink-0"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="text-slate-600 dark:text-slate-300 text-sm mb-1">{job.company}</div>

        {chips.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-1 gap-y-0.5 text-slate-500 dark:text-slate-400 text-xs mb-2">
            {chips.map((chip, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-slate-300 dark:text-slate-600">·</span>}
                <span>{chip}</span>
              </span>
            ))}
          </div>
        )}

        {bullets.length > 0 ? (
          <ul className="list-disc list-inside text-slate-600 dark:text-slate-300 text-xs space-y-0.5 mb-2">
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        ) : job.summary ? (
          <p className="text-slate-600 dark:text-slate-300 text-xs line-clamp-2 mb-2">{job.summary}</p>
        ) : null}

        {searchTags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {searchTags.map((tag) => (
              <button
                key={tag}
                onClick={() => onTagClick(tag)}
                className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-colors"
              >
                #{tag}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 mt-1">
          <span className="text-slate-400 dark:text-slate-500 text-xs">{postedAgo(job.posted_at)}</span>
          <div className="flex gap-2">
            <button
              onClick={onReview}
              disabled={isPending}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Review
            </button>
            <button
              onClick={onIgnore}
              disabled={isPending}
              className="rounded border border-slate-300 dark:border-slate-600 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              Ignore
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function JobsPage() {
  const queryClient = useQueryClient();
  const [keywords, setKeywords] = useState("python");
  const [location, setLocation] = useState("");
  const [maxPages, setMaxPages] = useState(3);
  const [provider, setProvider] = useState<"seek" | "indeed" | "linkedin">("seek");
  const [activeTag, setActiveTag] = useState<string | undefined>(undefined);

  const tagsQuery = useQuery({
    queryKey: ["search-tags"],
    queryFn: fetchSearchTags,
  });

  const jobsQuery = useQuery({
    queryKey: ["jobs", "active", provider, activeTag],
    queryFn: () => fetchJobs({ exclude: "ignored,in_review", provider, keyword: activeTag }),
  });

  const searchMutation = useMutation({
    mutationFn: runSearch,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["search-tags"] });
      queryClient.invalidateQueries({ queryKey: ["applications"] });
    },
  });

  const queueMutation = useMutation({
    mutationFn: queueJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const ignoreMutation = useMutation({
    mutationFn: ignoreJob,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
  });

  const availableTags = tagsQuery.data ?? [];

  return (
    <section className="space-y-6">
      <header className="flex items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Jobs</h1>
      </header>

      <form
        className="flex flex-wrap items-end gap-3 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4"
        onSubmit={(e) => {
          e.preventDefault();
          searchMutation.mutate({ provider, keywords, location: location || undefined, max_pages: maxPages });
        }}
      >
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-600 dark:text-slate-300">Provider</span>
          <select
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 bg-white dark:bg-slate-700 dark:text-slate-100"
            value={provider}
            onChange={(e) => setProvider(e.target.value as "seek" | "indeed" | "linkedin")}
          >
            <option value="seek">SEEK</option>
            <option value="indeed">Indeed</option>
            <option value="linkedin">LinkedIn</option>
          </select>
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-600 dark:text-slate-300">Keywords</span>
          <input
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 bg-white dark:bg-slate-700 dark:text-slate-100"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-600 dark:text-slate-300">Location (optional)</span>
          <input
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 bg-white dark:bg-slate-700 dark:text-slate-100"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-slate-600 dark:text-slate-300">Pages</span>
          <input
            type="number"
            min={1}
            max={10}
            className="rounded border border-slate-300 dark:border-slate-600 px-2 py-1 w-16 bg-white dark:bg-slate-700 dark:text-slate-100"
            value={maxPages}
            onChange={(e) => setMaxPages(Math.max(1, Math.min(10, Number(e.target.value))))}
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
          <span className="text-sm text-slate-500 dark:text-slate-400">
            {searchMutation.data.persisted} new, {searchMutation.data.blocked} blocked
          </span>
        )}
        {searchMutation.isError && (
          <span className="text-sm text-red-600">{(searchMutation.error as Error).message}</span>
        )}
      </form>

      {availableTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">Filter by search:</span>
          <button
            onClick={() => setActiveTag(undefined)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              activeTag === undefined
                ? "bg-slate-800 dark:bg-slate-200 text-white dark:text-slate-900 border-slate-800 dark:border-slate-200"
                : "bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-200 border-slate-300 dark:border-slate-500 hover:border-slate-500 dark:hover:border-slate-400"
            }`}
          >
            All
          </button>
          {availableTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? undefined : tag)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                activeTag === tag
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-white dark:bg-slate-700 text-emerald-700 dark:text-emerald-400 border-emerald-300 dark:border-emerald-700 hover:border-emerald-500 dark:hover:border-emerald-500"
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {jobsQuery.isLoading && <p className="text-slate-500 dark:text-slate-400">Loading…</p>}
      {jobsQuery.isError && (
        <p className="text-red-600">Failed to load jobs: {(jobsQuery.error as Error).message}</p>
      )}
      {jobsQuery.isSuccess && jobsQuery.data.length === 0 && (
        <p className="text-slate-500 dark:text-slate-400">
          {activeTag
            ? `No jobs found for search "${activeTag}".`
            : "No new jobs. Run a search to discover some."}
        </p>
      )}

      {jobsQuery.isSuccess && jobsQuery.data.length > 0 && (
        <div className="space-y-3">
          {jobsQuery.data.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              onReview={() => queueMutation.mutate(job.id)}
              onIgnore={() => ignoreMutation.mutate(job.id)}
              isPending={queueMutation.isPending || ignoreMutation.isPending}
              onTagClick={(tag) => setActiveTag(tag)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
