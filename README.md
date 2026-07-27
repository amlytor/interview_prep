# QuantPrep

A local, Kaplan Schweser-style study platform for quant risk / quant finance
interview prep — probability brain teasers, derivatives & Greeks intuition,
and risk theory (VaR / ES), with AI-powered grading and Socratic feedback via
the Anthropic API.

Everything runs in your browser. Your questions, attempt history, and spaced-repetition
schedule are stored in `localStorage` on your machine — nothing is sent anywhere
except grading requests, which go directly from your browser to `api.anthropic.com`
using your own API key.

## Features

- **Dashboard** — overall hit rate, current streak, hit rate by topic, weak-area
  callouts, due-for-review count, and a 30-day performance chart.
- **Drill** — one question at a time, filterable by topic and difficulty. Free-text
  answers are graded by Claude (correct / partial / incorrect, Socratic feedback,
  and a "why missed" tag); multiple-choice is graded instantly and locally.
- **Review** — serves only questions you've previously missed, on a spaced-repetition
  schedule (2 → 7 → 21 days, resets on a repeat miss).
- **Mock Interview** — a timed, mixed-topic session (default 5 questions, configurable).
  No feedback is shown until you finish; the debrief screen grades everything at once
  and gives you a per-question breakdown plus session-level weak topics.
- **Add Question** — grow your own bank as you work through Zhou, Crack, or your own notes.
- **Settings** — API key, grading model (defaults to `claude-sonnet-4-6`, configurable),
  a personal spend-awareness note, and JSON export/import of all your data.

Seeded with ~24 starter questions covering the full technique taxonomy: geometric
distribution, Bayes' theorem, combinatorics, linearity of expectation,
symmetry/condition-on-first-step, complementary counting, without-replacement
shortcuts, gambler's ruin, coupon collector, pigeonhole, recursive states,
continuous distributions, out-of-the-box logic, derivatives/Greeks, VaR/risk
theory, and statistics.

## Setup

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (typically `http://localhost:5173`).

### Get an Anthropic API key

1. Go to [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
   and create a key.
2. In QuantPrep, go to **Settings**, paste the key in, pick a model, and click
   **Save Settings**. Use **Test Connection** to confirm it works.

Multiple-choice questions never need the API — only free-text grading calls it.

### Model configuration

The grading model defaults to `claude-sonnet-4-6`. You can switch to
`claude-sonnet-5`, `claude-opus-5`, `claude-haiku-4-5`, or type in any other
model ID via "Custom model ID..." in the Settings dropdown.

### Spend awareness

QuantPrep does not track live API spend (that would require a backend). Settings
has a free-text "personal budget note" field you can use to remind yourself of a
self-imposed cap — check actual usage anytime at
[console.anthropic.com/settings/cost](https://console.anthropic.com/settings/cost).

## Your data

All progress (question bank, attempt history, spaced-repetition schedule, and
settings) lives in your browser's `localStorage` under the key
`quantprep_data_v1`. This means:

- It persists across sessions on the same browser/machine.
- It does **not** sync across browsers or devices.
- Clearing your browser's site data will erase it.

Use **Settings → Export to JSON** regularly to back up your progress, and
**Import from JSON** to restore it (e.g., on a new machine, or after clearing
browser data). Export/import round-trips your entire question bank, attempt
log, review schedule, and settings (including your API key, if you choose to
back that up too).

## Project structure

```
src/
  types.ts              Core data model (Question, Attempt, SrsState, Settings, ...)
  lib/
    topics.ts            Fixed technique taxonomy
    storage.ts            localStorage read/write + JSON export/import
    store.tsx              React context: single source of truth + actions
    srs.ts                   Spaced-repetition scheduling (2/7/21-day ladder)
    stats.ts                  Hit-rate, streak, weak-area, and time-series aggregation
    anthropic.ts               Anthropic API client: grading + connection test
    seedQuestions.ts             Starter question bank (~24 questions)
  components/            Shared UI: Sidebar, QuestionAttempt, badges, timer, banners
  pages/                  One file per sidebar destination (Dashboard, Drill, Review,
                          Mock, AddQuestion, Settings)
```

The code is intentionally flat (no routing library, no state management library
beyond React context) so it's easy to read and modify directly — most changes
you'd want to make (add a topic, tweak the SRS schedule, change the grading
prompt) live in a single small file under `src/lib/`.

## Build

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally
npm run lint        # oxlint
```
