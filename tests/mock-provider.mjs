// A stand-in OpenAI-compatible provider, so the non-Anthropic code path can be
// exercised end to end without a real API key. Records what it receives.
import { createServer } from "node:http";

const received = [];

const server = createServer((req, res) => {
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST, OPTIONS",
  };
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.url === "/__received") {
    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify(received));
    return;
  }

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const parsed = JSON.parse(body);
    received.push({ url: req.url, auth: req.headers.authorization, body: parsed });

    // Reasoning-model simulation: burns the whole budget thinking and returns
    // empty visible content with finish_reason "length". This is what DeepSeek
    // V4 Pro (and other reasoning models) do when max_tokens is too small.
    if (parsed.model === "always-truncates" || (parsed.model === "reasoning-model" && parsed.max_tokens < 200)) {
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          finish_reason: "length",
          message: { role: "assistant", content: "", reasoning: "Let me think about this..." },
        }],
      }));
      return;
    }

    // Some providers return an error object inside a 200 response.
    if (parsed.model === "error-in-200") {
      res.writeHead(200, { ...cors, "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "No endpoints found for this model.", code: 404 } }));
      return;
    }

    const system = parsed.messages[0].content;
    let content = "OK";

    if (system.includes("grading a candidate's free-text answer")) {
      content = JSON.stringify({
        verdict: "incorrect",
        feedback: "You conditioned on the wrong event.",
        whyMissed: "misread problem",
      });
    } else if (system.includes("checking draft interview questions")) {
      // Clear the first draft, flag the rest, so both staging paths are covered.
      const count = (system.match(/\[\d+\]/g) ?? []).length ||
        (parsed.messages[1].content.match(/^\[\d+\]/gm) ?? []).length;
      content = JSON.stringify({
        results: Array.from({ length: count }, (_, i) =>
          i === 0
            ? { index: i, status: "clean", issues: [] }
            : { index: i, status: "suspect", issues: ["Two options are defensible."] },
        ),
      });
    } else if (system.includes("summarising a completed diagnostic conversation")) {
      // Include one invalid id to prove the prereq-closure filter works.
      content = JSON.stringify({
        tag: "missing prerequisite knowledge",
        summary: "You treated the events as independent when they aren't.",
        recommendedTopics: ["conditional-probability", "not-a-real-topic"],
      });
    } else if (system.includes("helping a student work out WHY")) {
      const turns = parsed.messages.filter((m) => m.role === "user").length;
      content =
        turns > 1
          ? "That confirms it — the gap is conditional probability, not this technique."
          : "You wrote P(A and B) = P(A)P(B). Were you assuming independence, or was that a slip?";
    } else if (system.includes("writing practice questions")) {
      content = JSON.stringify({
        questions: [
          {
            difficulty: "hard",
            type: "free_text",
            prompt: "Expected number of flips to see HTH?",
            canonicalAnswer: "10",
            explanation: "Set up state recursion.",
            technique: "condition on the first step",
            difficultyRationale: "Requires building and solving a state machine.",
          },
          {
            difficulty: "medium",
            type: "free_text",
            prompt: "A second generated question.",
            canonicalAnswer: "2",
            explanation: "Linearity.",
            technique: "linearity of expectation",
            difficultyRationale: "Two steps.",
          },
        ],
      });
    }

    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
});

server.listen(4599, () => console.log("mock provider on http://localhost:4599"));
