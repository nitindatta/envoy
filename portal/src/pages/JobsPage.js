import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchJobs, runSearch } from "@/api/jobs";
export default function JobsPage() {
    const queryClient = useQueryClient();
    const [keywords, setKeywords] = useState("python");
    const [location, setLocation] = useState("");
    const jobsQuery = useQuery({
        queryKey: ["jobs"],
        queryFn: () => fetchJobs(),
    });
    const searchMutation = useMutation({
        mutationFn: runSearch,
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
    });
    return (_jsxs("section", { className: "space-y-6", children: [_jsx("header", { className: "flex items-end justify-between gap-4", children: _jsx("h1", { className: "text-2xl font-semibold", children: "Jobs" }) }), _jsxs("form", { className: "flex flex-wrap items-end gap-3 rounded-md border bg-white p-4", onSubmit: (event) => {
                    event.preventDefault();
                    searchMutation.mutate({
                        provider: "seek",
                        keywords,
                        location: location || undefined,
                    });
                }, children: [_jsxs("label", { className: "flex flex-col text-sm", children: [_jsx("span", { className: "mb-1 text-slate-600", children: "Keywords" }), _jsx("input", { className: "rounded border px-2 py-1", value: keywords, onChange: (e) => setKeywords(e.target.value) })] }), _jsxs("label", { className: "flex flex-col text-sm", children: [_jsx("span", { className: "mb-1 text-slate-600", children: "Location (optional)" }), _jsx("input", { className: "rounded border px-2 py-1", value: location, onChange: (e) => setLocation(e.target.value) })] }), _jsx("button", { type: "submit", disabled: searchMutation.isPending, className: "rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50", children: searchMutation.isPending ? "Running…" : "Run search" }), searchMutation.isSuccess && (_jsxs("span", { className: "text-sm text-slate-600", children: ["persisted ", searchMutation.data.persisted, ", blocked ", searchMutation.data.blocked] })), searchMutation.isError && (_jsx("span", { className: "text-sm text-red-600", children: searchMutation.error.message }))] }), jobsQuery.isLoading && _jsx("p", { className: "text-slate-600", children: "Loading jobs\u2026" }), jobsQuery.isError && (_jsxs("p", { className: "text-red-600", children: ["Failed to load jobs: ", jobsQuery.error.message] })), jobsQuery.isSuccess && jobsQuery.data.length === 0 && (_jsx("p", { className: "text-slate-600", children: "No jobs yet. Run a search to discover some." })), jobsQuery.isSuccess && jobsQuery.data.length > 0 && (_jsx("div", { className: "overflow-hidden rounded-md border bg-white", children: _jsxs("table", { className: "w-full text-left text-sm", children: [_jsx("thead", { className: "bg-slate-100 text-slate-600", children: _jsxs("tr", { children: [_jsx("th", { className: "px-3 py-2", children: "Title" }), _jsx("th", { className: "px-3 py-2", children: "Company" }), _jsx("th", { className: "px-3 py-2", children: "Location" }), _jsx("th", { className: "px-3 py-2", children: "Provider" })] }) }), _jsx("tbody", { children: jobsQuery.data.map((job) => (_jsxs("tr", { className: "border-t", children: [_jsx("td", { className: "px-3 py-2", children: _jsx("a", { href: job.source_url, target: "_blank", rel: "noreferrer", className: "text-blue-600 hover:underline", children: job.title }) }), _jsx("td", { className: "px-3 py-2", children: job.company }), _jsx("td", { className: "px-3 py-2", children: job.location ?? "—" }), _jsx("td", { className: "px-3 py-2", children: job.provider })] }, job.id))) })] }) }))] }));
}
