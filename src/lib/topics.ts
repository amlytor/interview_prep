// Fixed technique taxonomy used to tag questions across the app.
export const TOPICS = [
  "Geometric distribution",
  "Enumerate scenarios",
  "Without-replacement shortcut",
  "Complementary counting",
  "Symmetry/condition-on-first-step",
  "Gambler's ruin",
  "Coupon collector",
  "Bayes theorem",
  "Combinatorics",
  "Pigeonhole",
  "Linearity of expectation",
  "Recursive states",
  "Continuous distributions",
  "Out-of-the-box logic",
  "Derivatives/Greeks",
  "VaR/risk theory",
  "Statistics",
] as const;

export type Topic = (typeof TOPICS)[number];
