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

- **Dashboard** — overall hit rate, daily streak, hit rate by topic, weak-area
  callouts, due-for-review count, and a 30-day performance chart. Plus two
  diagnostic panels: **"Why I'm getting things wrong"** (a pivot of your miss
  reasons, filterable by topic) and **"Recommended focus"**, which fires when
  your misses cluster on one cause, when a prerequisite keeps coming up in your
  diagnoses, or when you're grinding a topic whose prerequisite isn't solid —
  the point being to catch when the real gap is *underneath* what you're
  drilling. Every recommendation links straight to that topic's Learn or Drill.
- **Daily streak** — consecutive calendar days on which you hit your practice
  goal (configurable, default 1 question). Shows current and longest, and tells
  you whether today still needs doing.
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
  note. The prompt is anchored to real questions from the seed bank rather than
  the words "easy/medium/hard", and explicitly rules out faking difficulty with
  bigger numbers; each question declares the technique it tests and why it sits
  at its claimed level. A second API pass checks the batch for ambiguity, wrong
  answers, and duplicates before anything is staged.
- **Staging without spoilers** — reading a generated question's answer burns it
  as practice, so the staging screen shows only the prompt, topic, and claimed
  difficulty. Clean questions can be bulk-approved **unseen**; revealing an
  answer is a deliberate click and is recorded, so practice can prefer the
  questions you haven't spoiled.
- **Drill** — one question at a time, filterable by topic and difficulty. Free-text
  answers are graded by AI (correct / partial / incorrect, Socratic feedback,
  and a "why missed" tag); multiple-choice is graded instantly and locally.
  Questions whose answers you haven't seen are served first.
- **"Why did I get this wrong?"** — after a miss, a short diagnostic chat works
  out the *root cause*, which is often not the obvious one. It classifies into a
  fixed taxonomy (didn't recognise the technique / misread / couldn't execute /
  arithmetic slip / ran out of time / **missing prerequisite knowledge**) and,
  for that last one, names *which* upstream topic is weak — constrained to the
  actual prerequisite graph, so it can't invent a topic. The tag, a one-line
  summary you can rewrite, and the full transcript are kept on the attempt.
- **Difficulty feedback** — one tap after each answer (too easy / about right /
  too hard). That builds a per-topic calibration which is fed back into
  generation, so "too easy" three times means the next batch is pitched harder.
- **Review** — serves only questions you've previously missed, on a spaced-repetition
  schedule (2 → 7 → 21 days, resets on a repeat miss). Correct answers on advanced
  topics trickle partial review credit down to their direct prerequisites, so you
  aren't re-drilling basics you're exercising implicitly.
- **Mock Interview** — a timed, mixed-topic session (default 5 questions, configurable).
  No feedback is shown until you finish; the debrief screen grades everything at once
  and gives you a per-question breakdown plus session-level weak topics.
- **Your own topics** — the 43 seeded topics aren't a fixed set. "+ New topic" on
  the Topics page lets you add your own: give it a title, pick its prerequisites,
  write the note. It then behaves exactly like a seeded topic — mastery ring,
  unlock rules, Learn mode, quiz generation, trickle-down credit. Or paste raw,
  unstructured notes and let the model file them for you: it decides whether they
  belong under a topic you already have or deserve a new one, suggests
  prerequisites, and rewrites them into the standard note format. You approve
  before anything is saved.
- **Add Question** — grow your own bank as you work through Zhou, Crack, or your own notes.
- **Continuous backup** — point QuantPrep at a file on disk once and it
  auto-saves your whole state there on every change, so your progress isn't
  trapped in browser storage. Manual JSON export/import is always available too.
- **Settings** — AI provider and model, per-provider API keys, a personal
  spend-awareness note, backup, and JSON export/import of all your data.

Seed content lives in `src/data/studyNotes.json` (43 authored notes, whose
`prereqs` arrays define the knowledge graph) and `src/data/seedQuestions.json`
(405 authored questions), merged with the original starter bank for ~420 seeded
questions across the taxonomy. Every topic has at least six questions and a
note of 1,900–4,700 characters. Topics you add yourself live in your browser
alongside your progress, not in these files.

Coverage spans the material a quant finance or quant risk interview actually
draws on: probability, combinatorics and statistics; calculus methods and
linear algebra; modular arithmetic and proof technique; Markov chains,
martingales and Ito calculus; order statistics;
derivatives and the Greeks; VaR and risk theory; fixed income and the yield
curve; portfolio theory and CAPM; time series and volatility modelling; optimal
stopping; algorithms and numerical methods; and Fermi estimation. The market
risk side goes deeper still — interest rate risk and yield-curve PCA,
correlations and copulas, historical simulation and extreme value theory,
model-building VaR, Basel and FRTB, counterparty risk and margin, stress
testing, liquidity risk, model risk, and risk-neutral versus real-world
valuation. Derivatives and the Greeks is the largest topic at 67 questions,
covering both the puzzle angle and the desk-practice angle. The questions
are written for this app — each carries its own worked explanation, the
technique it tests, and why it sits at its stated difficulty.

The prerequisite graph is eight tiers deep and is meant to be load-bearing:
Ito calculus sits under derivatives, martingales under Ito, Markov chains under
martingales, and so on down to basic probability. That is what lets the
diagnostic chat say *which* upstream topic is actually missing rather than
gesturing at the topic you just failed.

Adding to the seed files reaches existing installs, not just fresh ones:
`loadData()` appends any seed question your stored data is missing and refreshes
authored notes you haven't edited. Both match on identity and skip anything
you've touched, so your attempt history, edits, and progress are never
overwritten. Because question ids are numbered per topic in file order, new
questions for a topic must be **appended** after that topic's existing entries —
inserting one in the middle renumbers the rest and duplicates them.

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
| **OpenRouter** *(default)* | DeepSeek, Qwen, Kimi, Claude, and hundreds more | One key for everything, and the least likely to be blocked from the browser. The model picker loads OpenRouter's live catalogue with per-million prices, so it's never out of date — type to search it. |
| **Anthropic** | Claude Sonnet 5, Opus 5, Fable 5, Haiku 4.5 | Native API, via the official SDK. |
| **DeepSeek** | `deepseek-chat`, `deepseek-reasoner` | Direct, cheap. |
| **Moonshot / Kimi** | `kimi-k2-*`, `moonshot-v1-*` | Direct. Switch the base URL for the `.cn` endpoint. |
| **Qwen / DashScope** | `qwen-max`, `qwen-plus`, `qwen-turbo` | Direct. International endpoint by default. |
| **Local** | Ollama, LM Studio, llama.cpp | No key, no bill, nothing leaves your machine. |
| **Custom** | anything OpenAI-compatible | vLLM, Together, Groq, a self-hosted gateway. |

Every provider except Anthropic speaks the OpenAI-compatible
`POST /chat/completions` shape, so any model ID the endpoint accepts works —
the dropdowns are starting points, and "Custom model ID..." takes anything.

### Different models for different jobs

One model doesn't fit every call the app makes, and the requirements pull in
opposite directions:

| Task | How often | What it needs |
| --- | --- | --- |
| **Grading**, **diagnostic chat** | Every free-text answer | Fast and cheap. The canonical answer and worked solution are *already in the prompt* — this is a comparison job, not a solving one, so a reasoning model burns tokens and latency for nothing. |
| **Generation**, **validation** | Once per batch | Strong. It has to invent a question *and* solve it correctly, and a wrong answer sits in your bank permanently — more so now that questions can be banked unseen. This is where a reasoning model earns its cost. |

**Settings → Use different models per task** lets each one override the default
(blank = use the default). Overrides are kept per provider, since a model ID
from one provider is meaningless on another.

Worth pointing **validation** at a different model from **generation**: a second
opinion catches far more than a model reviewing its own work, and that pass is
what stands between a subtly wrong generated answer and your question bank.

A fresh install starts on OpenRouter with `anthropic/claude-sonnet-5`; add a key
and you're going, or switch the model to `deepseek/...` or `qwen/...` from the
live list. **Upgrading an existing install never moves you** — data saved before
multi-provider support stays on Anthropic with the key and model it already had.

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

**A note on reasoning models.** Models like `deepseek/deepseek-v4-pro` spend
output tokens on internal reasoning before writing anything visible. QuantPrep
budgets enough headroom for that, so they work — but for grading they're mostly
wasted money: the task is "compare an answer to a rubric and write two
sentences", which a standard chat model does as well, faster and cheaper. If a
model ever runs out of budget mid-thought, the error says so explicitly rather
than reporting a mysterious empty response.

### Spend awareness

QuantPrep does not track live API spend (that would require a backend). Settings
has a free-text "personal budget note" field you can use to remind yourself of a
self-imposed cap — check actual usage in your provider's console
([Anthropic](https://console.anthropic.com/settings/cost),
[OpenRouter](https://openrouter.ai/activity)). Local models are free.

## Your data

All progress — question bank, attempt history, spaced-repetition schedule, study
notes, your own topics, staged AI questions, miss diagnoses, difficulty
ratings, and settings — lives in your
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

### Continuous backup (recommended)

**Settings → Continuous Backup → Choose backup file...** picks a file once;
after that QuantPrep writes your entire state to it every time anything
changes, debounced so a burst of typing produces one write. No remembering to
export. The file is an ordinary JSON backup — drop it back in via **Import from
JSON** on any machine. Put it in Dropbox / iCloud Drive / a git repo and your
progress follows you.

The browser remembers the file across reloads, and will ask you to re-grant
write permission after a restart (a one-click **Reconnect**; browsers
deliberately don't hand out silent, permanent disk access). Until you do, the
status line says so rather than failing quietly.

This uses the File System Access API, so it needs Chrome, Edge, or another
Chromium browser. Elsewhere the section explains that and points you at manual
export, which works everywhere.

### Manual export

**Settings → Export to JSON**, and **Import from JSON** to restore (a new
machine, a new browser, after clearing site data). Export/import round-trips
everything, including your own topics and notes, and old exports from earlier
schema versions import cleanly through the same migration path. Data from the
original v1 schema is migrated automatically on first load, and the old
`quantprep_data_v1` key is left untouched as a rollback backup.

## Project structure

```
src/
  types.ts              Core data model (Question, Attempt, SrsState, StudyNote, ...)
  data/
    studyNotes.json      43 authored study notes + the prerequisite graph (source of truth)
    seedQuestions.json   405 authored seed questions (source of truth)
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
    ai.ts                Grading, quiz generation + validation, note drafting,
                         note classification, miss diagnosis (chat + conclusion)
    calibration.ts       Per-topic difficulty calibration from your own ratings
    diagnostics.ts       Miss-reason pivot + "recommended focus" rules
    practice.ts          Question selection (prefers answers you haven't seen)
    backup.ts            Continuous auto-save to a file (File System Access API)
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
the preview server and a mock OpenAI-compatible provider, then runs five
suites: `smoke` (provider switching, custom-topic lifecycle), `migration`
(upgrading old saved data, export/import round-trip, and backfilling seed
content added since your data was written without touching your edits),
`provider` (a full
grading round-trip through a non-Anthropic endpoint, asserting the exact wire
format), `backup` (auto-save to a real file handle, debouncing, reconnect after
permission lapses, and the unsupported-browser fallback), and `diagnostic` (the
streak's day arithmetic, spoiler-free staging, calibration reaching the
generation prompt, and the diagnosis chat end to end). Needs a browser once — `npx playwright install chromium` — or set
`CHROMIUM_PATH` to one you already have.
