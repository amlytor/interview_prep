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

    const isGrading = parsed.messages[0].content.includes("grading a candidate's free-text answer");
    const content = isGrading
      ? JSON.stringify({ verdict: "partial", feedback: "Right setup, arithmetic slipped.", whyMissed: "arithmetic slip" })
      : "OK";

    res.writeHead(200, { ...cors, "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
  });
});

server.listen(4599, () => console.log("mock provider on http://localhost:4599"));
