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
- **Topics (knowledge tree)** — all 19 topics laid out in prerequisite tiers with a
  mastery ring per topic (0–100, recency-weighted). Proficiency (60+ over 3+
  attempts) unlocks dependent topics; 80+ over 5+ attempts counts as mastered.
  A "next up" recommendation points at your knowledge frontier.
- **Study notes** — one human-authored markdown note per topic (core idea /
  trigger / formulas / worked example / common mistakes), rendered with KaTeX
  math. Fully editable in-app with live preview. An "Expand with AI" button
  drafts improvements you review before applying — authored notes are never
  overwritten without explicit confirmation.
- **Learn mode** — read the note, then immediately get a 3–5 question practice
  burst and see your mastery score move. Minimal reading, fast into recall.
- **AI quiz generation** — generate recall + application questions from any
  note. Output is schema-validated and lands in a staging queue; nothing enters
  the live bank (or your mastery signal) until you approve it.
- **Drill** — one question at a time, filterable by topic and difficulty. Free-text
  answers are graded by Claude (correct / partial / incorrect, Socratic feedback,
  and a "why missed" tag); multiple-choice is graded instantly and locally.
- **Review** — serves only questions you've previously missed, on a spaced-repetition
  schedule (2 → 7 → 21 days, resets on a repeat miss). Correct answers on advanced
  topics trickle partial review credit down to their direct prerequisites, so you
  aren't re-drilling basics you're exercising implicitly.
- **Mock Interview** — a timed, mixed-topic session (default 5 questions, configurable).
  No feedback is shown until you finish; the debrief screen grades everything at once
  and gives you a per-question breakdown plus session-level weak topics.
- **Add Question** — grow your own bank as you work through Zhou, Crack, or your own notes.
- **Settings** — API key, grading model (defaults to `claude-sonnet-4-6`, configurable),
  a personal spend-awareness note, and JSON export/import of all your data.

Seed content lives in `src/data/studyNotes.json` (19 authored notes, whose
`prereqs` arrays define the knowledge graph) and `src/data/seedQuestions.json`
(35 authored questions), merged with the original starter bank for ~53 seeded
questions across the taxonomy.

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

All progress (question bank, attempt history, spaced-repetition schedule, study
notes, staged AI questions, and settings) lives in your browser's `localStorage`
under the key `quantprep_data_v2`. Data from the original v1 schema is migrated
automatically on first load (the old `quantprep_data_v1` key is left in place as
a rollback backup), and importing an old v1 JSON export runs the same migration.
This means:

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
  types.ts              Core data model (Question, Attempt, SrsState, StudyNote, ...)
  data/
    studyNotes.json      19 authored study notes + the prerequisite graph (source of truth)
    seedQuestions.json   35 authored seed questions (source of truth)
  lib/
    topics.ts            Canonical topic taxonomy (ids + display labels)
    seedData.ts          Import adapter for the src/data JSON files
    seedQuestions.ts     The original starter bank (retagged, deduped)
    storage.ts           localStorage read/write, v1→v2 migration, JSON export/import
    store.tsx            React context: single source of truth + actions
    srs.ts               Spaced repetition (2/7/21 ladder + trickle-down credit)
    mastery.ts           Mastery scores, unlock rules, tiers, next-topic recommendation
    stats.ts             Hit-rate, streak, weak-area, and time-series aggregation
    anthropic.ts         Anthropic API client: grading, quiz generation, note drafting
  components/            Shared UI: Sidebar, QuestionAttempt, Markdown+KaTeX renderer,
                         MasteryRing, TopicDetail, LearnSession, badges, timer, banners
  pages/                 One file per sidebar destination (Dashboard, Topics, Drill,
                         Review, Mock, AddQuestion, Settings)
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
