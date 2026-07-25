/**
 * One-shot local launcher: Docker API + Postgres, then Vite, then browser.
 * Usage: npm start
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const API_HEALTH = process.env.VITE_API_URL
  ? `${process.env.VITE_API_URL.replace(/\/$/, "")}/api/health`
  : "http://localhost:8000/api/health";
const APP_URL = process.env.APP_URL ?? "http://localhost:8080";

function run(command, args, { background = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: background ? "ignore" : "inherit",
      shell: true,
      detached: background,
      env: process.env,
    });

    if (background) {
      child.unref();
      resolve(child);
      return;
    }

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(child);
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function waitFor(url, { attempts = 90, delayMs = 1000 } = {}) {
  process.stdout.write(`Waiting for ${url}`);
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        process.stdout.write(" — ready\n");
        return;
      }
    } catch {
      // still starting
    }
    process.stdout.write(".");
    await sleep(delayMs);
  }
  process.stdout.write("\n");
  throw new Error(`Timed out waiting for ${url}`);
}

async function openBrowser(url) {
  const platform = process.platform;
  if (platform === "win32") {
    await run("cmd", ["/c", "start", "", url]);
  } else if (platform === "darwin") {
    await run("open", [url]);
  } else {
    await run("xdg-open", [url]);
  }
}

async function main() {
  console.log("Starting backend (Docker)…");
  await run("docker", ["compose", "up", "--build", "-d"]);

  await waitFor(API_HEALTH);

  console.log("Starting frontend (Vite)…");
  const vite = spawn("npx", ["vite", "dev"], {
    stdio: "inherit",
    shell: true,
    env: process.env,
  });

  await waitFor(APP_URL, { attempts: 60, delayMs: 500 });
  console.log(`Opening ${APP_URL}`);
  try {
    await openBrowser(APP_URL);
  } catch (err) {
    console.warn("Could not open browser automatically:", err.message ?? err);
    console.warn(`Open ${APP_URL} manually.`);
  }

  const shutdown = () => {
    if (!vite.killed) vite.kill("SIGTERM");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  vite.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
