// Runs the full end-to-end suite: builds nothing (run `npm run build` first),
// starts the preview server and the mock provider, runs each suite, tears down.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import net from "node:net";

const children = [];

function start(label, cmd, args) {
  // Own process group, so shutdown can take the whole tree down — `npx vite`
  // spawns a child of its own, and killing only the wrapper orphans the server
  // holding the port.
  const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"], detached: true });
  child.stderr.on("data", (d) => process.stderr.write(`[${label}] ${d}`));
  children.push(child);
  return child;
}

function stopAll() {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGKILL"); // negative pid = the whole group
    } catch {
      child.kill("SIGKILL");
    }
  }
}

// Ctrl-C or a harness timeout must not leave servers holding ports.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopAll();
    process.exit(130);
  });
}

/**
 * Is something bound to this port?
 *
 * Deliberately a raw TCP connect rather than fetch(): Node's fetch honours
 * HTTP_PROXY, and behind a proxy every request "succeeds" regardless of whether
 * anything is actually listening — which made the checks below report a stale
 * server that wasn't there.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1000, () => done(false));
  });
}

async function waitFor(port, label) {
  for (let i = 0; i < 60; i++) {
    if (await portInUse(port)) return;
    await sleep(250);
  }
  throw new Error(`${label} never came up on port ${port}`);
}

function run(name) {
  return new Promise((resolve) => {
    console.log(`\n─── ${name} ${"─".repeat(Math.max(0, 56 - name.length))}`);
    spawn(process.execPath, [`tests/${name}`], { stdio: "inherit" }).on("close", resolve);
  });
}

/**
 * A server left over from an interrupted run would satisfy waitFor() while
 * serving a stale build or an outdated mock, producing confusing failures.
 * Refuse to start rather than silently test the wrong thing.
 */
async function assertPortFree(port, label) {
  if (await portInUse(port)) {
    throw new Error(`${label} is already running on port ${port}. Stop it first (it may be stale).`);
  }
}

let exitCode = 0;
try {
  await assertPortFree(4173, "A preview server");
  await assertPortFree(4599, "A mock provider");

  start("preview", "npx", ["vite", "preview", "--port", "4173"]);
  start("mock", process.execPath, ["tests/mock-provider.mjs"]);
  await waitFor(4173, "preview server");
  await waitFor(4599, "mock provider");

  for (const suite of ["content.mjs", "smoke.mjs", "migration.mjs", "provider.mjs", "backup.mjs", "diagnostic.mjs", "resilience.mjs"]) {
    // Deliberately not `exitCode ||= await run(suite)`: ||= short-circuits, so
    // one failing suite would silently skip every suite after it.
    const code = await run(suite);
    if (code !== 0) exitCode = code;
  }
} catch (err) {
  console.error(err.message);
  exitCode = 1;
} finally {
  stopAll();
}

console.log(exitCode === 0 ? "\nAll suites passed." : "\nSome suites failed.");
process.exit(exitCode);
