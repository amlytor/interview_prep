# QuantPrep

A local, Kaplan Schweser-style study platform for quant risk / quant finance
interview prep — probability brain teasers, derivatives & Greeks intuition,
and risk theory (VaR / ES), with AI-powered grading and Socratic feedback from
the model of your choice.

Everything runs in your browser. Your questions, attempt history, and spaced-repetition
schedule are stored in `localStorage` on your machine — nothing is sent anywhere
except grading requests, which go directly from your browser to whichever AI
provider you configure, using your own API key. Point it at a local model and
nothing leaves your machine at all.

## Features

- **Dashboard** — overall hit rate, current streak, hit rate by topic, weak-area
  callouts, due-for-review count, and a 30-day performance chart.
- **Topics (knowledge tree)** — every topic laid out in prerequisite tiers with a
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
- **Your own topics** — the 19 seeded topics aren't a fixed set. "+ New topic" on
  the Topics page lets you add your own: give it a title, pick its prerequisites,
  write the note. It then behaves exactly like a seeded topic — mastery ring,
  unlock rules, Learn mode, quiz generation, trickle-down credit. Or paste raw,
  unstructured notes and let the model file them for you: it decides whether they
  belong under a topic you already have or deserve a new one, suggests
  prerequisites, and rewrites them into the standard note format. You approve
  before anything is saved.
- **Add Question** — grow your own bank as you work through Zhou, Crack, or your own notes.
- **Settings** — AI provider and model, per-provider API keys, a personal
  spend-awareness note, and JSON export/import of all your data.

Seed content lives in `src/data/studyNotes.json` (19 authored notes, whose
`prereqs` arrays define the knowledge graph) and `src/data/seedQuestions.json`
(35 authored questions), merged with the original starter bank for ~53 seeded
questions across the taxonomy. Topics you add yourself live in your browser
alongside your progress, not in these files.

## Setup

Requires Node.js 18+.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (typically `http://localhost:5173`).

### Pick an AI provider

Go to **Settings**, choose a provider, paste in a key, pick a model, and hit
**Test Connection**. Keys are stored per provider, so you can switch back and
forth without re-entering them.

| Provider | Models | Notes |
| --- | --- | --- |
| **Anthropic** | Claude Sonnet 5, Opus 5, Fable 5, Haiku 4.5 | Native API. The default. |
| **OpenRouter** | DeepSeek, Qwen, Kimi, Claude, and hundreds more | One key for everything, and the least likely to be blocked from the browser. |
| **DeepSeek** | `deepseek-chat`, `deepseek-reasoner` | Direct, cheap. |
| **Moonshot / Kimi** | `kimi-k2-*`, `moonshot-v1-*` | Direct. Switch the base URL for the `.cn` endpoint. |
| **Qwen / DashScope** | `qwen-max`, `qwen-plus`, `qwen-turbo` | Direct. International endpoint by default. |
| **Local** | Ollama, LM Studio, llama.cpp | No key, no bill, nothing leaves your machine. |
| **Custom** | anything OpenAI-compatible | vLLM, Together, Groq, a self-hosted gateway. |

Every provider except Anthropic speaks the OpenAI-compatible
`POST /chat/completions` shape, so any model ID the endpoint accepts works —
the dropdowns are starting points, and "Custom model ID..." takes anything.

**The one thing that can bite you is CORS.** QuantPrep has no backend, so
requests go straight from the page to the provider, and a provider that doesn't
send permissive CORS headers will have the browser block the call before it
leaves. Anthropic and OpenRouter both explicitly support browser calls. The
direct DeepSeek / Moonshot / DashScope endpoints are best-effort — if **Test
Connection** fails with a "couldn't reach" message, that's what happened, and
routing the same model through OpenRouter is the fix.

For a local model with Ollama, allow the dev origin:

```bash
OLLAMA_ORIGINS=http://localhost:5173 ollama serve
```

Multiple-choice questions never call the API — only free-text grading, quiz
generation, and note drafting do.

### Spend awareness

QuantPrep does not track live API spend (that would require a backend). Settings
has a free-text "personal budget note" field you can use to remind yourself of a
self-imposed cap — check actual usage in your provider's console
([Anthropic](https://console.anthropic.com/settings/cost),
[OpenRouter](https://openrouter.ai/activity)). Local models are free.

## Your data

All progress — question bank, attempt history, spaced-repetition schedule, study
notes, your own topics, staged AI questions, and settings — lives in your
browser's `localStorage` under the key `quantprep_data_v2`. It is written on
every change, synchronously, so there is no "unsaved work" to lose.

**It survives** closing the tab, quitting the browser, rebooting, `git pull`,
and rebuilding the app. Schema changes are additive and backfilled on load, so
upgrading the code never resets your progress.

**It does not survive** these, so know them:

- **A different origin.** `localStorage` is scoped to scheme + host + *port*.
  This is the one that actually catches people: if `5173` is busy, Vite silently
  starts on `5174`, and that is a different origin with its own empty storage.
  Your progress isn't gone — it's under the old port. Pin it with
  `npm run dev -- --port 5173` if you want to be sure.
- **Clearing site data / "cookies and other site data"** in browser settings.
- **Private / incognito windows**, which are wiped when the window closes.
- **A different browser or a different machine.** There is no sync; the data is
  in the browser, not in the repo, so cloning this repo elsewhere gets you the
  app with a fresh, empty history.

`localStorage` also caps out around 5 MB per origin. Attempts are tiny, so
you'd have to try, but if a write ever does fail the app logs a clear message to
the console and keeps running on in-memory state rather than crashing mid-drill
— export immediately if you see it.

So: use **Settings → Export to JSON** periodically, and **Import from JSON** to
restore (a new machine, a new browser, after clearing site data). Export/import
round-trips everything, including your own topics and notes, and old exports
from earlier schema versions import cleanly through the same migration path.
Data from the original v1 schema is migrated automatically on first load, and
the old `quantprep_data_v1` key is left untouched as a rollback backup.

## Project structure

```
src/
  types.ts              Core data model (Question, Attempt, SrsState, StudyNote, ...)
  data/
    studyNotes.json      19 authored study notes + the prerequisite graph (source of truth)
    seedQuestions.json   35 authored seed questions (source of truth)
  lib/
    topics.ts            Topic taxonomy: seeded ids + labels, custom-topic registry
    seedData.ts          Import adapter for the src/data JSON files
    seedQuestions.ts     The original starter bank (retagged, deduped)
    storage.ts           localStorage read/write, schema migration, JSON export/import
    store.tsx            React context: single source of truth + actions
    srs.ts               Spaced repetition (2/7/21 ladder + trickle-down credit)
    mastery.ts           Mastery scores, unlock rules, tiers, next-topic recommendation
    stats.ts             Hit-rate, streak, weak-area, and time-series aggregation
    providers.ts         The AI provider registry (add a backend by adding a row)
    ai.ts                Grading, quiz generation, note drafting, note classification
  components/            Shared UI: Sidebar, QuestionAttempt, Markdown+KaTeX renderer,
                         MasteryRing, TopicDetail, NewTopic, LearnSession, badges,
                         timer, banners
  pages/                 One file per sidebar destination (Dashboard, Topics, Drill,
                         Review, Mock, AddQuestion, Settings)
tests/                   End-to-end suites driven through a real browser
```

Adding an AI provider is a matter of adding one row to `PROVIDERS` in
`src/lib/providers.ts` — every feature funnels through a single
`completeText()` in `ai.ts`, which has exactly two implementations (Anthropic's
native API and the OpenAI-compatible shape).

The code is intentionally flat (no routing library, no state management library
beyond React context) so it's easy to read and modify directly — most changes
you'd want to make (add a topic, tweak the SRS schedule, change the grading
prompt) live in a single small file under `src/lib/`.

## Build

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the production build locally
npm run lint       # oxlint
npm run test:e2e   # end-to-end suites (build first)
```

`npm run test:e2e` drives a real browser against the production build. It starts
the preview server and a mock OpenAI-compatible provider, then runs three
suites: `smoke` (provider switching, custom-topic lifecycle), `migration`
(upgrading old saved data, export/import round-trip), and `provider` (a full
grading round-trip through a non-Anthropic endpoint, asserting the exact wire
format). Needs a browser once — `npx playwright install chromium` — or set
`CHROMIUM_PATH` to one you already have.
