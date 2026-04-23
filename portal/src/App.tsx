import { NavLink, Route, Routes } from "react-router-dom";
import ApplyPage from "./pages/ApplyPage";
import JobsPage from "./pages/JobsPage";
import QueuePage from "./pages/QueuePage";
import ReviewPage from "./pages/ReviewPage";
import ReviewDeskPage from "./pages/ReviewDeskPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import DriftPage from "./pages/DriftPage";
import SetupPage from "./pages/SetupPage";
import { useTheme } from "./lib/theme";

const navItems = [
  { to: "/", label: "Jobs", end: true },
  { to: "/review-desk", label: "Review Desk" },
  { to: "/queue", label: "Queue" },
  { to: "/review", label: "Review" },
  { to: "/history", label: "History" },
  { to: "/drift", label: "Drift" },
  { to: "/setup", label: "Setup" },
];

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      onClick={toggle}
      className="ml-auto flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 hover:border-slate-400 dark:hover:border-slate-400 transition-colors"
      title="Toggle dark mode"
    >
      {theme === "dark" ? "☀ Light" : "☾ Dark"}
    </button>
  );
}

export default function App() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100">
      <header className="border-b bg-white dark:bg-slate-800 dark:border-slate-700">
        <nav className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `text-sm font-medium ${
                  isActive
                    ? "text-blue-600 dark:text-blue-400"
                    : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
          <ThemeToggle />
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Routes>
          <Route path="/" element={<JobsPage />} />
          <Route path="/review-desk" element={<ReviewDeskPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/apply/:applicationId" element={<ApplyPage />} />
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/drift" element={<DriftPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/setup" element={<SetupPage />} />
        </Routes>
      </main>
    </div>
  );
}
