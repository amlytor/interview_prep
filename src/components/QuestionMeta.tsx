import type { Difficulty } from "../types";
import { topicLabel } from "../lib/topics";

export function DifficultyBadge({ difficulty }: { difficulty: Difficulty }) {
  return <span className={`badge badge-${difficulty}`}>{difficulty}</span>;
}

export function TopicBadges({ topics }: { topics: string[] }) {
  return (
    <div className="tag-row">
      {topics.map((t) => (
        <span key={t} className="badge badge-topic">
          {topicLabel(t)}
        </span>
      ))}
    </div>
  );
}

export function VerdictBadge({ verdict }: { verdict: "correct" | "partial" | "incorrect" }) {
  const label = verdict === "correct" ? "Correct" : verdict === "partial" ? "Partial" : "Incorrect";
  return <span className={`badge badge-verdict-${verdict}`}>{label}</span>;
}
