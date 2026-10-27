// Loads team/team.config.json and team/.env from the nearest project root.
// Zero dependencies. Node 20+.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findProjectRoot(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "team", "team.config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function loadEnv(root) {
  const file = join(root, "team", ".env");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}

export function loadConfig() {
  const root = findProjectRoot();
  if (!root) {
    console.error("agile-team: no team/team.config.json found in this directory or its parents. Run /team-setup first.");
    process.exit(2);
  }
  loadEnv(root);
  const cfg = JSON.parse(readFileSync(join(root, "team", "team.config.json"), "utf8"));
  cfg.__root = root;
  return cfg;
}

export function requireEnv(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) {
    console.error(`agile-team: missing environment variables: ${missing.join(", ")} (set them in team/.env)`);
    process.exit(2);
  }
}

// Tiny argv parser: positional args + --key value / --flag
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

export function today(tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function nowStamp(tz) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date());
}
