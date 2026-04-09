import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink, Route, Routes } from "react-router-dom";
import ApplyPage from "./pages/ApplyPage";
import JobsPage from "./pages/JobsPage";
import QueuePage from "./pages/QueuePage";
import ReviewPage from "./pages/ReviewPage";
import ReviewDeskPage from "./pages/ReviewDeskPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import DriftPage from "./pages/DriftPage";
const navItems = [
    { to: "/", label: "Jobs", end: true },
    { to: "/review-desk", label: "Review Desk" },
    { to: "/queue", label: "Queue" },
    { to: "/review", label: "Review" },
    { to: "/history", label: "History" },
    { to: "/drift", label: "Drift" },
    { to: "/settings", label: "Settings" },
];
export default function App() {
    return (_jsxs("div", { className: "min-h-screen bg-slate-50 text-slate-900", children: [_jsx("header", { className: "border-b bg-white", children: _jsx("nav", { className: "mx-auto flex max-w-6xl gap-4 px-6 py-4", children: navItems.map((item) => (_jsx(NavLink, { to: item.to, end: item.end, className: ({ isActive }) => `text-sm font-medium ${isActive ? "text-blue-600" : "text-slate-600 hover:text-slate-900"}`, children: item.label }, item.to))) }) }), _jsx("main", { className: "mx-auto max-w-6xl px-6 py-8", children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(JobsPage, {}) }), _jsx(Route, { path: "/review-desk", element: _jsx(ReviewDeskPage, {}) }), _jsx(Route, { path: "/queue", element: _jsx(QueuePage, {}) }), _jsx(Route, { path: "/apply/:applicationId", element: _jsx(ApplyPage, {}) }), _jsx(Route, { path: "/review", element: _jsx(ReviewPage, {}) }), _jsx(Route, { path: "/history", element: _jsx(HistoryPage, {}) }), _jsx(Route, { path: "/drift", element: _jsx(DriftPage, {}) }), _jsx(Route, { path: "/settings", element: _jsx(SettingsPage, {}) })] }) })] }));
}
