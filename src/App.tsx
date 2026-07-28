import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { useStore } from "./lib/store";
import { dueCount as computeDueCount } from "./lib/srs";
import type { TopicId } from "./lib/topics";
import { Dashboard } from "./pages/Dashboard";
import { Topics } from "./pages/Topics";
import { Drill } from "./pages/Drill";
import { Review } from "./pages/Review";
import { Mock } from "./pages/Mock";
import { AddQuestion } from "./pages/AddQuestion";
import { SettingsPage } from "./pages/Settings";

export type Page = "dashboard" | "topics" | "drill" | "review" | "mock" | "add" | "settings";

function App() {
  const [page, setPage] = useState<Page>("dashboard");
  // Set when a topic page hands off to Drill ("Drill this topic"); cleared on
  // any normal navigation so a later manual visit to Drill starts unfiltered.
  const [drillTopicId, setDrillTopicId] = useState<TopicId | null>(null);
  const { data } = useStore();
  const dueCount = computeDueCount(data.srs);

  function navigate(next: Page) {
    setDrillTopicId(null);
    setPage(next);
  }

  function drillTopic(topicId: TopicId) {
    setDrillTopicId(topicId);
    setPage("drill");
  }

  return (
    <div className="app-shell">
      <Sidebar current={page} onNavigate={navigate} dueCount={dueCount} />
      <main className="main-content">
        {page === "dashboard" && <Dashboard onNavigate={navigate} onDrillTopic={drillTopic} />}
        {page === "topics" && <Topics onNavigate={navigate} onDrillTopic={drillTopic} />}
        {page === "drill" && <Drill onNavigate={navigate} initialTopicId={drillTopicId} onDrillTopic={drillTopic} />}
        {page === "review" && <Review onNavigate={navigate} onDrillTopic={drillTopic} />}
        {page === "mock" && <Mock onNavigate={navigate} />}
        {page === "add" && <AddQuestion onNavigate={navigate} />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}

export default App;
