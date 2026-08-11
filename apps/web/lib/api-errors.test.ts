/**
 * Run: pnpm --filter @personai/web test
 * (tsx assertion script — matches apps/server test style)
 */
import assert from "node:assert/strict";
import {
  collapseApiFailureMessage,
  describeApiFailure,
} from "./api-errors.ts";

const HINT =
  "Check API URL matches page scheme (http vs https). Unlock profile if health works but chat returns 401.";
const LEGACY_HINT =
  "If https://HOST:8443 is down (`tailscale serve status` → No serve config), run " +
  "`HTTPS=1 ./scripts/vps-tailscale.sh --serve-only HOST`, or open http://HOST:3000 " +
  "with API http://HOST:4000 (browse-only). Unlock the profile if health works but chat returns 401.";

const base = "http://your-host.tailXXXX.ts.net:4000";
const path = "/team/chat/stream";

// —— collapse: triple-wrapped legacy toast ——
const once = `Can't reach API at ${base} (${path}) (Failed to fetch). ${LEGACY_HINT}`;
const twice = `Can't reach API at ${base} (${path}) (${once}). ${LEGACY_HINT}`;
const thrice = `Can't reach API at ${base} (${path}) (${twice}). ${LEGACY_HINT}`;

const collapsed = collapseApiFailureMessage(thrice);
assert.equal(
  collapsed,
  `Can't reach API at ${base} (${path}). ${HINT}`,
  "triple-wrapped legacy copy must collapse to one short line",
);
assert.equal(count(collapsed, /tailscale serve status/i), 0);
assert.equal(count(collapsed, /Can['’]t reach API at /i), 1);
assert.equal(count(collapsed, /Check API URL matches page scheme/i), 1);

// —— describeApiFailure idempotent across streamSSE → processor → queue ——
const raw = new TypeError("Failed to fetch");
const a = describeApiFailure(raw, { apiBaseUrl: base, path }).message;
const b = describeApiFailure(new Error(a), { apiBaseUrl: base, path }).message;
const c = describeApiFailure(new Error(b), { apiBaseUrl: base, path }).message;
assert.equal(a, b);
assert.equal(b, c);
assert.equal(a, `Can't reach API at ${base} (${path}). ${HINT}`);
assert.equal(count(c, /Check API URL matches page scheme/i), 1);
assert.ok(!/Failed to fetch/i.test(c), "short copy should not echo Failed to fetch");

// —— collapse short-circuits already-short message ——
assert.equal(collapseApiFailureMessage(a), a);

// —— describeApiFailure collapses persisted IndexedDB lastError ——
const fromIdb = describeApiFailure(new Error(thrice), { path }).message;
assert.equal(fromIdb, `Can't reach API at ${base} (${path}). ${HINT}`);

console.log("api-errors.test.ts: ok");

function count(text: string, re: RegExp): number {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  return (text.match(new RegExp(re.source, flags)) ?? []).length;
}
