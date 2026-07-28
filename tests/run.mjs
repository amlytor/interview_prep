// Runs the full end-to-end suite: builds nothing (run `npm run build` first),
// starts the preview server and the mock provider, runs each suite, tears down.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const children = [];

function start(label, cmd, args) {
  const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
  child.stderr.on("data", (d) => process.stderr.write(`[${label}] ${d}`));
  children.push(child);
  return child;
}

async function waitFor(url, label) {
  for (let i = 0; i < 40; i++) {
    try {
      await fetch(url);
      return;
    } catch {
      await sleep(250);
    }
  }
  throw new Error(`${label} never came up at ${url}`);
}

function run(name) {
  return new Promise((resolve) => {
    console.log(`\n─── ${name} ${"─".repeat(Math.max(0, 56 - name.length))}`);
    spawn(process.execPath, [`tests/${name}`], { stdio: "inherit" }).on("close", resolve);
  });
}

let exitCode = 0;
try {
  start("preview", "npx", ["vite", "preview", "--port", "4173"]);
  start("mock", process.execPath, ["tests/mock-provider.mjs"]);
  await waitFor("http://localhost:4173/", "preview server");
  await waitFor("http://localhost:4599/__received", "mock provider");

  for (const suite of ["smoke.mjs", "migration.mjs", "provider.mjs"]) {
    exitCode ||= await run(suite);
  }
} catch (err) {
  console.error(err.message);
  exitCode = 1;
} finally {
  for (const c of children) c.kill();
}

console.log(exitCode === 0 ? "\nAll suites passed." : "\nSome suites failed.");
process.exit(exitCode);
