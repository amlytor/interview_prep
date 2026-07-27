import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { useStore } from "./lib/store";
import { dueCount as computeDueCount } from "./lib/srs";
import { Dashboard } from "./pages/Dashboard";
import { Drill } from "./pages/Drill";
import { Review } from "./pages/Review";
import { Mock } from "./pages/Mock";
import { AddQuestion } from "./pages/AddQuestion";
import { SettingsPage } from "./pages/Settings";

export type Page = "dashboard" | "drill" | "review" | "mock" | "add" | "settings";

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const { data } = useStore();
  const dueCount = computeDueCount(data.srs);

  return (
    <div className="app-shell">
      <Sidebar current={page} onNavigate={setPage} dueCount={dueCount} />
      <main className="main-content">
        {page === "dashboard" && <Dashboard onNavigate={setPage} />}
        {page === "drill" && <Drill onNavigate={setPage} />}
        {page === "review" && <Review onNavigate={setPage} />}
        {page === "mock" && <Mock onNavigate={setPage} />}
        {page === "add" && <AddQuestion onNavigate={setPage} />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

export default App;
