import type { Question } from "../types";

// Starter question bank. Weighted toward the core probability techniques
// (geometric, Bayes, combinatorics, linearity of expectation, symmetry) with
// a smaller set covering derivatives/Greeks, VaR/risk theory, and statistics
// so every topic in the taxonomy has at least one seeded question.
const now = Date.now();

export const SEED_QUESTIONS: Question[] = [
  {
    id: "seed-1",
    prompt:
      "You flip a fair coin repeatedly until you see the first heads. What is the expected number of flips?",
    topics: ["Geometric distribution"],
    difficulty: "easy",
    answerMode: "free-text",
    canonicalAnswer: "2",
    explanation:
      "The number of flips until the first success follows a Geometric(p) distribution with p = 0.5. " +
      "For a geometric distribution, E[X] = 1/p. Here E[X] = 1/0.5 = 2 flips. " +
      "Intuition: on average you need 2 tries to hit an event with 50% probability.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-2",
    prompt:
      "You roll a fair six-sided die repeatedly until you roll a 6. What is the probability that it takes MORE than 10 rolls?",
    topics: ["Geometric distribution"],
    difficulty: "medium",
    answerMode: "free-text",
    canonicalAnswer: "(5/6)^10 ≈ 0.1615",
    explanation:
      "Let X be the number of rolls until the first 6, X ~ Geometric(p = 1/6). " +
      "P(X > n) = (1-p)^n because it means the first n rolls were all failures. " +
      "So P(X > 10) = (5/6)^10 ≈ 0.1615. This 'tail' formula for geometric distributions is worth memorizing — " +
      "it comes up constantly and avoids summing a geometric series by hand.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-3",
    prompt:
      "You have two coins in your pocket: one fair coin and one two-headed coin (always lands heads). You pick one at random and flip it 3 times, getting heads all 3 times. What is the probability the coin you picked is the two-headed one?",
    topics: ["Bayes theorem"],
    difficulty: "medium",
    answerMode: "free-text",
    canonicalAnswer: "8/9 ≈ 0.889",
    explanation:
      "Let T = two-headed coin, F = fair coin, and D = observing 3 heads in a row.\n" +
      "P(T) = P(F) = 0.5 (prior).\n" +
      "P(D|T) = 1 (always heads). P(D|F) = (1/2)^3 = 1/8.\n" +
      "By Bayes: P(T|D) = P(D|T)P(T) / [P(D|T)P(T) + P(D|F)P(F)]\n" +
      "= (1)(0.5) / [(1)(0.5) + (0.125)(0.5)] = 0.5 / 0.5625 = 8/9 ≈ 0.889.\n" +
      "Note how quickly the two-headed hypothesis dominates as you get more consecutive heads — this is the core intuition behind likelihood ratios.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-4",
    prompt:
      "A disease affects 1 in 1000 people. A test for the disease has a 99% true positive rate and a 5% false positive rate. If a random person tests positive, what is the probability they actually have the disease?",
    topics: ["Bayes theorem"],
    difficulty: "hard",
    answerMode: "free-text",
    canonicalAnswer: "≈ 1.94%",
    explanation:
      "Let D = has disease, + = tests positive.\n" +
      "P(D) = 0.001, P(+|D) = 0.99, P(+|not D) = 0.05, P(not D) = 0.999.\n" +
      "P(D|+) = P(+|D)P(D) / [P(+|D)P(D) + P(+|not D)P(not D)]\n" +
      "= (0.99)(0.001) / [(0.99)(0.001) + (0.05)(0.999)]\n" +
      "= 0.00099 / (0.00099 + 0.04995) = 0.00099 / 0.05094 ≈ 0.0194.\n" +
      "This is the classic 'base rate fallacy' result: even a fairly accurate test on a rare condition produces mostly false positives. " +
      "Sanity check by imagining 100,000 people: ~100 are sick (99 test positive), ~99,900 are healthy (~4,995 test positive anyway) — " +
      "so of the ~5,094 positives, only ~99 are truly sick.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-5",
    prompt: "How many distinct ways can you arrange the letters in the word \"STATISTICS\"?",
    topics: ["Combinatorics"],
    difficulty: "easy",
    answerMode: "free-text",
    canonicalAnswer: "50,400",
    explanation:
      "STATISTICS has 10 letters with repeats: S×3, T×3, A×1, I×2, C×1.\n" +
      "Number of distinct arrangements = 10! / (3! · 3! · 1! · 2! · 1!) = 3,628,800 / (6·6·1·2·1) = 3,628,800 / 72 = 50,400.\n" +
      "General rule: for a multiset with n total items and repeat counts n1, n2, ..., the arrangement count is n! / (n1!·n2!·...).",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-6",
    prompt:
      "How many people must be in a room to GUARANTEE that at least 3 of them share a birth month (assume 12 possible birth months)?",
    topics: ["Pigeonhole", "Combinatorics"],
    difficulty: "medium",
    answerMode: "free-text",
    canonicalAnswer: "25",
    explanation:
      "This is a pigeonhole problem, not a probability one — we want a guarantee, not a likelihood.\n" +
      "With 12 months (holes), the worst case packs as many people as possible with at most 2 per month before being forced into a 3rd: " +
      "12 months × 2 people = 24 people can all avoid a triple. The 25th person must create a month with 3.\n" +
      "General formula: to guarantee k+1 items in some hole with n holes, you need n·k + 1 items. Here n=12, k=2, so 12·2+1 = 25.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-7",
    prompt:
      "n people at a party each throw their hat into a pile, then everyone grabs a random hat. What is the expected number of people who get their OWN hat back?",
    topics: ["Linearity of expectation"],
    difficulty: "medium",
    answerMode: "free-text",
    canonicalAnswer: "1 (for any n)",
    explanation:
      "Define indicator X_i = 1 if person i gets their own hat back, 0 otherwise. E[X_i] = P(person i gets their own hat) = 1/n " +
      "(by symmetry, each person is equally likely to end up with any of the n hats).\n" +
      "By linearity of expectation, E[total matches] = E[sum X_i] = sum E[X_i] = n · (1/n) = 1.\n" +
      "The key insight is that linearity of expectation holds even though the X_i are NOT independent — you never need to reason about the joint distribution.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-8",
    prompt:
      "A standard 52-card deck is shuffled and revealed one card at a time. What is the expected number of times you see a 'record' — a card of higher rank than every card revealed so far (the first card is always a record)?",
    topics: ["Linearity of expectation"],
    difficulty: "hard",
    answerMode: "free-text",
    canonicalAnswer: "H_52 = sum_{k=1}^{52} 1/k ≈ 4.54",
    explanation:
      "Define X_k = 1 if the card at position k is a record (the max rank among the first k cards revealed).\n" +
      "By symmetry, the card at position k is equally likely to be any of the k cards among the first k in rank order, so P(X_k = 1) = 1/k, " +
      "independent of what happened before.\n" +
      "By linearity of expectation, E[# records] = sum_{k=1}^{52} 1/k = H_52 (the 52nd harmonic number) ≈ 4.54.\n" +
      "This is a very common 'records' pattern — recognize it whenever a problem asks for the expected count of running maxima/minima in a random permutation.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-9",
    prompt:
      "Two players alternate flipping a fair coin; Player A goes first. The first player to flip heads wins. What is the probability Player A wins?",
    topics: ["Symmetry/condition-on-first-step", "Geometric distribution"],
    difficulty: "medium",
    answerMode: "free-text",
    canonicalAnswer: "2/3",
    explanation:
      "Condition on the first flip: with probability 1/2, A flips heads and wins immediately. " +
      "With probability 1/2, A flips tails, and now B is in exactly A's original position, except it's B's turn — so B wins with A's original win-probability, " +
      "meaning A wins the REST of the game with probability (1 - p), where p is A's win probability.\n" +
      "So p = 1/2 + 1/2 · (1 - p)  =>  p = 1/2 + 1/2 - p/2  =>  (3/2)p = 1  =>  p = 2/3.\n" +
      "This 'condition on the first step, then recognize a self-similar sub-problem' trick generalizes to many first-to-X games.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-10",
    prompt:
      "n people are randomly seated around a round table. What is the probability that two specific people, Alice and Bob, end up sitting next to each other?",
    topics: ["Symmetry/condition-on-first-step"],
    difficulty: "easy",
    answerMode: "free-text",
    canonicalAnswer: "2/(n-1)",
    explanation:
      "By symmetry, fix Alice's seat (rotational symmetry means her exact seat doesn't matter). " +
      "Bob is then equally likely to be in any of the remaining n-1 seats. Exactly 2 of those seats (immediately left and right of Alice) are adjacent to her.\n" +
      "So P(adjacent) = 2/(n-1). This 'fix one person, count favorable seats for the other' shortcut avoids enumerating all n! seatings.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-11",
    prompt: "You roll two fair six-sided dice. What is the probability that AT LEAST one die shows a 6?",
    topics: ["Complementary counting"],
    difficulty: "easy",
    answerMode: "multiple-choice",
    canonicalAnswer: "11/36",
    choices: [
      { id: "a", text: "1/6" },
      { id: "b", text: "1/3" },
      { id: "c", text: "11/36" },
      { id: "d", text: "1/2" },
    ],
    correctChoiceId: "c",
    explanation:
      "'At least one 6' is much easier to compute via its complement: 'no 6 on either die.'\n" +
      "P(no 6 on a single die) = 5/6, so P(no 6 on either die) = (5/6)^2 = 25/36.\n" +
      "P(at least one 6) = 1 - 25/36 = 11/36.\n" +
      "Whenever you see 'at least one', check whether the complement ('none') is easier to compute — it almost always is for independent trials.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-12",
    prompt:
      "In a room of 30 people, what is the approximate probability that at least two people share the same birthday? (Assume 365 equally likely birthdays, ignore leap years.)",
    topics: ["Complementary counting"],
    difficulty: "hard",
    answerMode: "free-text",
    canonicalAnswer: "≈ 70.6%",
    explanation:
      "Complement is much easier: P(no shared birthday) = P(all 30 birthdays distinct).\n" +
      "P(all distinct) = (365/365)(364/365)(363/365)...(336/365) = 365! / [(365-30)! · 365^30].\n" +
      "Computing this product gives ≈ 0.294, so P(at least one match) = 1 - 0.294 ≈ 0.706, or about 70.6%.\n" +
      "The famous 'birthday paradox' result — it only takes 23 people to cross the 50% threshold, which is far fewer than most people's intuition suggests.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-13",
    prompt:
      "A standard 52-card deck is shuffled and dealt face up one card at a time. What is the probability that the first Ace appears before the first King?",
    topics: ["Without-replacement shortcut", "Symmetry/condition-on-first-step"],
    difficulty: "medium",
    answerMode: "free-text",
    canonicalAnswer: "1/2",
    explanation:
      "Ignore all 44 cards that are neither an Ace nor a King — they're irrelevant to the question of 'which comes first.' " +
      "Only the relative order of the 4 Aces and 4 Kings among themselves matters, and by symmetry every one of these 8 cards is equally likely " +
      "to be the first one revealed among the 8.\n" +
      "Since 4 of the 8 are Aces, P(first among these 8 is an Ace) = 4/8 = 1/2.\n" +
      "This 'shrink to only the relevant cards' shortcut avoids a full without-replacement calculation and works for any 'which type appears first' question.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-14",
    prompt:
      "A gambler starts with $3 and makes $1 bets on fair coin flips (win $1 on heads, lose $1 on tails), stopping when they reach $10 or go broke ($0). What is the probability they reach $10 before going broke?",
    topics: ["Gambler's ruin"],
    difficulty: "hard",
    answerMode: "free-text",
    canonicalAnswer: "3/10 = 0.3",
    explanation:
      "This is the classic Gambler's Ruin problem. For a FAIR game (p = 0.5), the probability of reaching N before 0, starting from i, " +
      "is simply i/N (a linear function of starting wealth) — this falls out of solving the difference equation P(i) = 0.5·P(i-1) + 0.5·P(i+1) " +
      "with boundary conditions P(0)=0, P(N)=1.\n" +
      "Here i=3, N=10, so P(reach 10 first) = 3/10 = 0.3.\n" +
      "Know the general (unfair, p ≠ 0.5) formula too: P(i) = [1-(q/p)^i] / [1-(q/p)^N] where q=1-p — interviewers love asking the follow-up.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-15",
    prompt:
      "A cereal box contains one of 6 different toys, chosen uniformly at random and independently each time you buy a box. What is the expected number of boxes you need to buy to collect all 6 toys?",
    topics: ["Coupon collector"],
    difficulty: "medium",
    answerMode: "free-text",
    canonicalAnswer: "14.7 boxes (= 6·H_6)",
    explanation:
      "This is the Coupon Collector's Problem. Break the process into 6 stages: stage k is the time spent collecting the k-th new toy after already having k-1 distinct toys.\n" +
      "While you have k-1 distinct toys, the probability a new box gives a new toy is (6-(k-1))/6, so the expected number of boxes in stage k is a geometric mean of 6/(6-k+1).\n" +
      "Total expectation = sum_{k=1}^{6} 6/(6-k+1) = 6·(1/6 + 1/5 + 1/4 + 1/3 + 1/2 + 1/1) = 6·H_6 ≈ 6 × 2.45 = 14.7 boxes.\n" +
      "General formula: for n distinct coupons, E[boxes to collect all] = n·H_n ≈ n·ln(n) for large n.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-16",
    prompt:
      "You flip a fair coin repeatedly. What is the expected number of flips until you see the pattern HH (two heads in a row)?",
    topics: ["Recursive states"],
    difficulty: "hard",
    answerMode: "free-text",
    canonicalAnswer: "6",
    explanation:
      "Set up states based on progress toward the pattern. Let E0 = expected additional flips from 'no progress' (last flip wasn't H, or we just started), " +
      "and E1 = expected additional flips given the last flip WAS an H.\n" +
      "From E0: flip once (1 step). With prob 1/2 it's H → move to state E1. With prob 1/2 it's T → stay in E0.\n" +
      "  E0 = 1 + 0.5·E1 + 0.5·E0  =>  0.5·E0 = 1 + 0.5·E1  =>  E0 = 2 + E1\n" +
      "From E1: flip once. With prob 1/2 it's H → DONE (pattern complete). With prob 1/2 it's T → back to E0.\n" +
      "  E1 = 1 + 0.5·(0) + 0.5·E0 = 1 + 0.5·E0\n" +
      "Substitute: E0 = 2 + 1 + 0.5·E0 = 3 + 0.5·E0  =>  0.5·E0 = 3  =>  E0 = 6.\n" +
      "Fun fact: E[flips to see HT] is only 4 — patterns with 'overlap' (like HH) take longer on average than non-overlapping ones (like HT), " +
      "even though both have the same per-flip probability.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-17",
    prompt: "You flip 3 fair coins. What is the probability of getting EXACTLY 2 heads?",
    topics: ["Enumerate scenarios", "Combinatorics"],
    difficulty: "easy",
    answerMode: "multiple-choice",
    canonicalAnswer: "3/8",
    choices: [
      { id: "a", text: "1/8" },
      { id: "b", text: "1/4" },
      { id: "c", text: "3/8" },
      { id: "d", text: "1/2" },
    ],
    correctChoiceId: "c",
    explanation:
      "There are 2^3 = 8 equally likely outcomes. The outcomes with exactly 2 heads are: HHT, HTH, THH — that's C(3,2) = 3 outcomes.\n" +
      "P(exactly 2 heads) = 3/8.\n" +
      "In general, for n fair coin flips, P(exactly k heads) = C(n,k) / 2^n.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-18",
    prompt:
      "You have two ropes. Each takes exactly 60 minutes to burn end-to-end, but each burns UNEVENLY along its length (so the halfway point isn't necessarily reached at the 30-minute mark). Using only these two ropes and a lighter, how can you measure exactly 45 minutes?",
    topics: ["Out-of-the-box logic"],
    difficulty: "medium",
    answerMode: "free-text",
    canonicalAnswer:
      "Light rope A at both ends and rope B at one end simultaneously. When A finishes (30 min), light B's other end too — B finishes 15 min later. Total: 45 min.",
    explanation:
      "The key insight: even though a rope burns unevenly, lighting it from BOTH ends always makes it finish in exactly HALF its total burn time — " +
      "because the two flame fronts are consuming the rope's total 'fuel' from opposite directions simultaneously, so together they always finish in 30 minutes no matter how the unevenness is distributed.\n" +
      "Step 1: Light rope A at both ends AND rope B at one end, all at t=0. Rope A will fully burn in exactly 30 minutes (regardless of unevenness).\n" +
      "Step 2: The instant rope A finishes (t=30 min), light rope B's other end too. Rope B has been burning from one end for 30 minutes, so it has exactly " +
      "30 minutes of 'single-end' burn time left. Lighting the other end now means those remaining 30 minutes of fuel burn from both ends, finishing in 15 more minutes.\n" +
      "Step 3: Total elapsed time when rope B fully burns = 30 + 15 = 45 minutes.\n" +
      "This is a great example of 'uneven burning doesn't break time symmetry, only distance symmetry' — a common trap that leads people to (incorrectly) try to find a physical halfway point on the rope.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-19",
    prompt:
      "A portfolio's daily returns are normally distributed with mean 0 and standard deviation 2%. What is the 1-day 99% Value at Risk (VaR), expressed as a percentage of portfolio value?",
    topics: ["VaR/risk theory", "Continuous distributions"],
    difficulty: "medium",
    answerMode: "free-text",
    canonicalAnswer: "≈ 4.65% (= 2.326 × 2%)",
    explanation:
      "For normally distributed returns, VaR at confidence level α is VaR_α = z_α · σ, where z_α is the α-quantile of the standard normal " +
      "(the number of standard deviations such that only (1-α) of the mass lies beyond it in the loss direction).\n" +
      "For α = 99%, z_0.99 ≈ 2.326.\n" +
      "VaR_99% = 2.326 × 2% ≈ 4.65% of portfolio value.\n" +
      "Interpretation: on a 'normal' day, you'd expect to lose no more than ~4.65% with 99% confidence — but VaR says nothing about how bad the remaining 1% of days can be, which is exactly what Expected Shortfall is designed to address.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-20",
    prompt:
      "Using the same portfolio as above (daily returns ~ N(0, 2%)), what is the 1-day 99% Expected Shortfall (ES) — the expected loss GIVEN that the loss exceeds the VaR threshold?",
    topics: ["VaR/risk theory", "Continuous distributions", "Statistics"],
    difficulty: "hard",
    answerMode: "free-text",
    canonicalAnswer: "≈ 5.33%",
    explanation:
      "For a normal distribution, Expected Shortfall at confidence α has a closed form: ES_α = σ · φ(z_α) / (1-α), " +
      "where φ is the standard normal PDF (not CDF) evaluated at the VaR quantile z_α.\n" +
      "z_0.99 ≈ 2.326. φ(2.326) = (1/√(2π)) · e^(-2.326²/2) ≈ 0.0267.\n" +
      "ES_99% = 2% × 0.0267 / 0.01 ≈ 2% × 2.665 ≈ 5.33%.\n" +
      "ES is always ≥ VaR at the same confidence level (here 5.33% > 4.65%) because it averages over the entire tail beyond VaR rather than just marking the threshold — " +
      "this is exactly why regulators (Basel III/FRTB) shifted market risk capital requirements from VaR to ES.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-21",
    prompt: "For a European call option that is deep in-the-money, what does its delta approach as expiration nears?",
    topics: ["Derivatives/Greeks"],
    difficulty: "easy",
    answerMode: "multiple-choice",
    canonicalAnswer: "1",
    choices: [
      { id: "a", text: "0" },
      { id: "b", text: "0.5" },
      { id: "c", text: "1" },
      { id: "d", text: "Undefined" },
    ],
    correctChoiceId: "c",
    explanation:
      "Delta measures how much the option's price moves per $1 move in the underlying. A deep in-the-money call is essentially certain to be exercised, " +
      "so it starts behaving like a forward contract on the stock — its price moves nearly 1:1 with the stock.\n" +
      "As expiration approaches, time value shrinks to zero and a deep ITM call's delta converges to 1 (deep OTM converges to 0). " +
      "At-the-money options have delta near 0.5 and it's the AT-the-money delta whose GAMMA spikes hardest as expiry nears (since a tiny move can flip it ITM/OTM).",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-22",
    prompt:
      "You are long a call option (bought, not sold). Is your gamma positive or negative, and what does this mean about how your delta changes as the underlying price rises?",
    topics: ["Derivatives/Greeks"],
    difficulty: "medium",
    answerMode: "free-text",
    canonicalAnswer:
      "Positive gamma. Delta increases as the underlying rises (and decreases as it falls) — the position's sensitivity grows in the favorable direction.",
    explanation:
      "Gamma is the rate of change of delta with respect to the underlying price (the second derivative of option price w.r.t. spot). " +
      "Being long ANY option (call or put) means you are long gamma — your position has positive convexity.\n" +
      "For a long call specifically: as the stock rises, delta increases toward 1 (you become 'more long'); as the stock falls, delta decreases toward 0 " +
      "(you become 'less long', capping your losses). This convex, 'gains accelerate / losses decelerate' payoff shape is exactly why long options benefit from volatility " +
      "and why option buyers pay a premium (theta decay) for positive gamma exposure.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-23",
    prompt:
      "X and Y are two random variables. What is Var(X+Y) in terms of Var(X) and Var(Y) when X and Y are independent? What changes if they are NOT independent, with covariance Cov(X,Y)?",
    topics: ["Statistics"],
    difficulty: "medium",
    answerMode: "free-text",
    canonicalAnswer: "Independent: Var(X)+Var(Y). Otherwise: Var(X)+Var(Y)+2Cov(X,Y).",
    explanation:
      "In general, Var(X+Y) = Var(X) + Var(Y) + 2·Cov(X,Y) — this holds always, independence or not.\n" +
      "When X and Y are independent, Cov(X,Y) = 0, so the formula simplifies to Var(X+Y) = Var(X) + Var(Y).\n" +
      "This generalizes to n variables: Var(sum X_i) = sum Var(X_i) + 2·sum_{i<j} Cov(X_i, X_j) — the pairwise covariance terms are exactly why " +
      "diversification reduces portfolio variance only when asset correlations are less than 1.",
    createdAt: now,
    custom: false,
  },
  {
    id: "seed-24",
    prompt: "X is uniformly distributed on [0, 1]. What is E[X²]?",
    topics: ["Continuous distributions"],
    difficulty: "easy",
    answerMode: "free-text",
    canonicalAnswer: "1/3",
    explanation:
      "For a continuous random variable, E[g(X)] = ∫ g(x)·f(x) dx, where f(x) is the density. For X ~ Uniform[0,1], f(x) = 1 on [0,1].\n" +
      "E[X²] = ∫₀¹ x² · 1 dx = [x³/3]₀¹ = 1/3.\n" +
      "Note this is NOT the same as (E[X])² = (1/2)² = 1/4 — the gap between them, 1/3 - 1/4 = 1/12, is exactly Var(X) for a Uniform[0,1], " +
      "consistent with the general identity Var(X) = E[X²] - (E[X])².",
    createdAt: now,
    custom: false,
  },
];
