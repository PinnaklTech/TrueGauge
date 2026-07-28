/**
 * Fail production frontend builds that would bake localhost into the bundle.
 * Usage: node scripts/assert-vite-prod-env.mjs [app|admin]
 */
const mode = (process.argv[2] || "app").toLowerCase();

function bad(url) {
  const u = (url || "").trim();
  return !u || /localhost|127\.0\.0\.1/i.test(u);
}

const api = process.env.VITE_API_URL;
if (bad(api)) {
  console.error(
    "Production build blocked: set VITE_API_URL to https://api.thetruegage.com (see .env.production.example).",
  );
  process.exit(1);
}

if (mode === "admin") {
  const app = process.env.VITE_APP_URL;
  if (bad(app)) {
    console.error(
      "Production build blocked: set VITE_APP_URL to https://app.thetruegage.com (see master-admin/.env.production.example).",
    );
    process.exit(1);
  }
}

console.log(`Vite prod env OK (${mode}): API=${api.trim()}`);
