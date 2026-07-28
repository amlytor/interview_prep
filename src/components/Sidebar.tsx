import type { Page } from "../App";

interface NavItem {
  page: Page;
  label: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { page: "dashboard", label: "Dashboard", icon: "▦" },
  { page: "topics", label: "Topics", icon: "◈" },
  { page: "drill", label: "Drill", icon: "✎" },
  { page: "review", label: "Review", icon: "↻" },
  { page: "mock", label: "Mock Interview", icon: "⏱" },
  { page: "add", label: "Add Question", icon: "+" },
  { page: "settings", label: "Settings", icon: "⚙" },
];

interface SidebarProps {
  current: Page;
  onNavigate: (page: Page) => void;
  dueCount: number;
}

export function Sidebar({ current, onNavigate, dueCount }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">Q</div>
        <div>
          <div className="sidebar-brand-text">QuantPrep</div>
          <div className="sidebar-brand-sub">Interview Study</div>
        </div>
      </div>

      <div className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.page}
            type="button"
            className={`sidebar-link${current === item.page ? " active" : ""}`}
            onClick={() => onNavigate(item.page)}
          >
            <span className="icon">{item.icon}</span>
            <span>{item.label}</span>
            {item.page === "review" && dueCount > 0 && (
              <span className="sidebar-due-badge">{dueCount}</span>
            )}
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        Local &amp; private — your data never leaves this browser except for grading calls to Anthropic.
      </div>
    </nav>
  );
}
