// Canonical topic taxonomy. The ids come from src/data/studyNotes.json and are
// the stable identifiers stored on questions, notes, and attempts; `label` is
// only for display. Two topics (basic-probability, conditional-probability)
// were added in v2 and have no v1 counterpart.
export type TopicId =
  | "basic-probability"
  | "geometric-distribution"
  | "enumerate-scenarios"
  | "without-replacement-shortcut"
  | "complementary-counting"
  | "symmetry-condition-first"
  | "gamblers-ruin"
  | "coupon-collector"
  | "bayes-theorem"
  | "conditional-probability"
  | "combinatorics"
  | "pigeonhole"
  | "linearity-of-expectation"
  | "recursive-states"
  | "continuous-distributions"
  | "out-of-the-box"
  | "derivatives-greeks"
  | "var-risk-theory"
  | "statistics";

export interface TopicInfo {
  id: TopicId;
  label: string;
}

export const TOPICS: TopicInfo[] = [
  { id: "basic-probability", label: "Basic probability" },
  { id: "conditional-probability", label: "Conditional probability" },
  { id: "geometric-distribution", label: "Geometric distribution" },
  { id: "enumerate-scenarios", label: "Enumerate scenarios" },
  { id: "without-replacement-shortcut", label: "Without-replacement shortcut" },
  { id: "complementary-counting", label: "Complementary counting" },
  { id: "symmetry-condition-first", label: "Symmetry/condition-on-first-step" },
  { id: "gamblers-ruin", label: "Gambler's ruin" },
  { id: "coupon-collector", label: "Coupon collector" },
  { id: "bayes-theorem", label: "Bayes theorem" },
  { id: "combinatorics", label: "Combinatorics" },
  { id: "pigeonhole", label: "Pigeonhole" },
  { id: "linearity-of-expectation", label: "Linearity of expectation" },
  { id: "recursive-states", label: "Recursive states" },
  { id: "continuous-distributions", label: "Continuous distributions" },
  { id: "out-of-the-box", label: "Out-of-the-box logic" },
  { id: "derivatives-greeks", label: "Derivatives/Greeks" },
  { id: "var-risk-theory", label: "VaR/risk theory" },
  { id: "statistics", label: "Statistics" },
];

const LABEL_BY_ID = new Map<string, string>(TOPICS.map((t) => [t.id, t.label]));

/** Display label for a topic id; falls back to the raw id for unknown values. */
export function topicLabel(id: string): string {
  return LABEL_BY_ID.get(id) ?? id;
}

export function isTopicId(value: string): value is TopicId {
  return LABEL_BY_ID.has(value);
}

// v1 stored topics as display strings. This map drives the v1 -> v2 migration
// (and importing old JSON backups). All 17 v1 labels map 1:1 onto ids.
export const V1_LABEL_TO_ID: Record<string, TopicId> = {
  "Geometric distribution": "geometric-distribution",
  "Enumerate scenarios": "enumerate-scenarios",
  "Without-replacement shortcut": "without-replacement-shortcut",
  "Complementary counting": "complementary-counting",
  "Symmetry/condition-on-first-step": "symmetry-condition-first",
  "Gambler's ruin": "gamblers-ruin",
  "Coupon collector": "coupon-collector",
  "Bayes theorem": "bayes-theorem",
  "Combinatorics": "combinatorics",
  "Pigeonhole": "pigeonhole",
  "Linearity of expectation": "linearity-of-expectation",
  "Recursive states": "recursive-states",
  "Continuous distributions": "continuous-distributions",
  "Out-of-the-box logic": "out-of-the-box",
  "Derivatives/Greeks": "derivatives-greeks",
  "VaR/risk theory": "var-risk-theory",
  "Statistics": "statistics",
};
