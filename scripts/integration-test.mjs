#!/usr/bin/env node
const BASE = process.env.API_URL || "http://127.0.0.1:4000";
const TEST_PASSWORD = process.env.PERSONAI_TEST_PASSWORD || "integration-test-password-8";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function req(method, path, { body, profileId, token } = {}) {
  const headers = {};
  if (profileId) headers["X-Profile-Id"] = profileId;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text, res };
}

const NEED = [
  "secretary",
  "architect",
  "forge",
  "qa_auditor",
  "cfo",
  "legal_aide",
  "medical_integrator",
  "bio_mechanic",
  "mystic",
  "stylist",
  "wingman",
  "career_strategist",
];

async function ensureAuth() {
  let r = await req("GET", "/profiles");
  if (r.status !== 200 || !Array.isArray(r.json?.profiles)) {
    throw new Error("GET /profiles failed — is the API running?");
  }
  let profile = r.json.profiles[0];
  if (!profile) {
    r = await req("POST", "/profiles", {
      body: { name: "Integration", password: TEST_PASSWORD },
    });
    if (r.status >= 300 || !r.json?.token) {
      throw new Error(`create profile failed: ${r.status} ${r.text}`);
    }
    return { token: r.json.token, profileId: r.json.profile.id };
  }

  if (!profile.hasPassword) {
    r = await req("POST", "/auth/setup", {
      body: { profileId: profile.id, password: TEST_PASSWORD },
    });
    if (r.status >= 300 || !r.json?.token) {
      throw new Error(`auth setup failed: ${r.status} ${r.text}`);
    }
    return { token: r.json.token, profileId: profile.id };
  }

  r = await req("POST", "/auth/login", {
    body: { profileId: profile.id, password: TEST_PASSWORD },
  });
  if (r.status === 401) {
    throw new Error(
      `Login failed for profile ${profile.id}. Set PERSONAI_TEST_PASSWORD to the profile password.`,
    );
  }
  if (r.status >= 300 || !r.json?.token) {
    throw new Error(`auth login failed: ${r.status} ${r.text}`);
  }
  return { token: r.json.token, profileId: profile.id };
}

async function main() {
  let r = await req("GET", "/health");
  ok("GET /health", r.status === 200 && r.json?.ok);

  r = await req("GET", "/health/");
  ok("GET /health/ (trailing slash)", r.status === 200 && r.json?.ok);

  r = await req("GET", "/profiles/");
  ok("GET /profiles/ (trailing slash)", r.status === 200 && Array.isArray(r.json?.profiles));

  r = await req("GET", "/license");
  ok("GET /license without auth → 401", r.status === 401);

  const { token, profileId: P } = await ensureAuth();
  ok("auth session", !!token && !!P, `profile=${P}`);

  r = await req("GET", "/ollama/health", { token, profileId: P });
  ok("GET /ollama/health", r.status === 200);

  r = await req("GET", "/license", { token, profileId: P });
  ok("GET /license teamChat", r.status === 200 && r.json?.features?.teamChat !== undefined);

  r = await req("GET", "/profiles");
  ok("GET /profiles", r.status === 200 && Array.isArray(r.json?.profiles));

  r = await req("GET", "/specialists", { profileId: P, token });
  const ids = (r.json?.specialists || []).map((s) => s.id);
  ok("GET /specialists ×12", r.status === 200 && NEED.every((id) => ids.includes(id)), `n=${ids.length}`);

  r = await req("GET", "/confirmations", { profileId: P, token });
  ok("GET /confirmations", r.status === 200 && Array.isArray(r.json?.confirmations));

  for (const [method, path] of [
    ["GET", "/finance/budget"],
    ["GET", "/finance/qr-bills"],
    ["GET", "/finance/transactions"],
    ["GET", "/legal/tasks"],
    ["GET", "/medical/complaints"],
    ["GET", "/ingest/queue"],
    ["GET", "/archive/documents"],
    ["GET", "/briefing/today"],
    ["GET", "/advisor/sessions"],
    ["GET", "/life/today"],
    ["GET", "/life/habits"],
  ]) {
    r = await req(method, path, { profileId: P, token });
    ok(`${method} ${path}`, r.status === 200, `status=${r.status}`);
  }

  r = await req("POST", "/finance/qr-bills", {
    profileId: P,
    token,
    body: { creditorName: "IT AG", iban: "CH9300762011623852957", amount: 10, currency: "CHF" },
  });
  const billId = r.json?.id;
  ok("POST /finance/qr-bills", !!billId);

  r = await req("PATCH", `/finance/qr-bills/${billId}`, {
    profileId: P,
    token,
    body: { status: "PAID" },
  });
  ok("PATCH PAID → 202 confirm", r.status === 202 && r.json?.needsConfirm, `status=${r.status}`);
  if (r.json?.confirmation?.id) {
    const c = await req("POST", `/confirmations/${r.json.confirmation.id}/confirm`, {
      profileId: P,
      token,
    });
    ok("confirm qr.mark_paid", c.status < 300);
  }

  r = await req("POST", "/legal/tasks", {
    profileId: P,
    token,
    body: { title: "IT Frist", type: "DEADLINE" },
  });
  ok("POST /legal/tasks", !!r.json?.id);

  r = await req("POST", "/medical/complaints", {
    profileId: P,
    token,
    body: { category: "PHYSICAL", title: "IT", description: "test", severity: "MILD" },
  });
  const complaintId = r.json?.id;
  ok("POST /medical/complaints", !!complaintId);

  r = await req("POST", "/medical/export", {
    profileId: P,
    token,
    body: {
      title: "IT",
      dateRangeFrom: new Date().toISOString(),
      dateRangeTo: new Date().toISOString(),
      complaintIds: complaintId ? [complaintId] : [],
    },
  });
  ok("POST /medical/export → 202", r.status === 202 && r.json?.needsConfirm);

  r = await req("POST", "/career/pdf", {
    profileId: P,
    token,
    body: { title: "CV", sections: [{ heading: "X", body: "Y" }] },
  });
  ok("POST /career/pdf → 202", r.status === 202 && r.json?.needsConfirm);
  if (r.json?.confirmation?.id) {
    await req("POST", `/confirmations/${r.json.confirmation.id}/confirm`, { profileId: P, token });
    const pdf = await req("POST", "/career/pdf", {
      profileId: P,
      token,
      body: { title: "CV", sections: [{ heading: "X", body: "Y" }], confirmed: true },
    });
    ok("career PDF bytes", pdf.status === 200);
  }

  r = await req("POST", "/briefing/generate", { profileId: P, token, body: {} });
  ok("POST /briefing/generate", r.status < 300);

  const res = await fetch(`${BASE}/team/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Profile-Id": P,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ message: "Ping Staff", specialist: "secretary" }),
  });
  const ct = res.headers.get("content-type") || "";
  ok("POST /team/chat/stream SSE", res.status === 200 && ct.includes("text/event-stream"), ct);
  try {
    await res.body?.cancel();
  } catch {
    /* ignore */
  }

  const failed = results.filter((x) => !x.pass);
  console.log(`\nSUMMARY total=${results.length} pass=${results.length - failed.length} fail=${failed.length}`);
  if (failed.length) {
    for (const f of failed) console.log(" -", f.name, f.detail);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
