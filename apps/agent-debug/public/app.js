const SESSION_KEY = "agent-debug-session";
const TOKEN_KEY = "agent-debug-token";

const els = {
  thread: document.getElementById("thread"),
  textInput: document.getElementById("textInput"),
  fileInput: document.getElementById("fileInput"),
  sendBtn: document.getElementById("sendBtn"),
  composeBtn: document.getElementById("composeBtn"),
  urgentToggle: document.getElementById("urgentToggle"),
  tokenInput: document.getElementById("tokenInput"),
  statusPill: document.getElementById("statusPill"),
  previews: document.getElementById("previews"),
};

/** UUID that works on http:// Tailscale hosts (crypto.randomUUID needs a secure context). */
function newId() {
  try {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  } catch {
    /* ignore */
  }
  if (globalThis.crypto?.getRandomValues) {
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = [...buf].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

let sessionId = localStorage.getItem(SESSION_KEY) || newId();
localStorage.setItem(SESSION_KEY, sessionId);
els.tokenInput.value = localStorage.getItem(TOKEN_KEY) || "";

/** @type {File[]} */
let pendingFiles = [];

function token() {
  return els.tokenInput.value.trim();
}

function persistToken() {
  localStorage.setItem(TOKEN_KEY, token());
  syncSendEnabled();
}

function syncSendEnabled() {
  const hasToken = Boolean(token());
  const busy = els.sendBtn.dataset.busy === "1";
  els.sendBtn.disabled = busy || !hasToken;
  els.composeBtn.disabled = busy || !hasToken;
  els.sendBtn.title = hasToken ? "" : "Paste AGENT_DEBUG_TOKEN above first";
  els.composeBtn.title = hasToken ? "" : "Paste AGENT_DEBUG_TOKEN above first";
}

function authHeaders(json = false) {
  const h = {};
  if (json) h["content-type"] = "application/json";
  const t = token();
  if (t) {
    h.Authorization = `Bearer ${t}`;
    h["X-Agent-Debug-Token"] = t;
  }
  return h;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...authHeaders(Boolean(opts.body)), ...(opts.headers || {}) },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    throw new Error(data?.error || data?.hint || `${res.status}`);
  }
  return data;
}

function renderPreviews() {
  els.previews.innerHTML = "";
  pendingFiles.forEach((file, idx) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.alt = file.name;
    const rm = document.createElement("button");
    rm.type = "button";
    rm.textContent = "×";
    rm.onclick = () => {
      pendingFiles.splice(idx, 1);
      renderPreviews();
    };
    chip.append(img, rm);
    els.previews.append(chip);
  });
}

function bubbleHtml(msg) {
  const time = new Date(msg.createdAt).toLocaleTimeString();
  const badges = [
    `<span class="badge">${msg.status}</span>`,
    msg.urgent ? `<span class="badge urgent">urgent</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  const imgs = (msg.images || [])
    .map((img) => {
      const src = img.thumbUrl || img.url;
      if (!src) return "";
      const q = token() ? `?token=${encodeURIComponent(token())}` : "";
      return `<img src="${src}${q}" alt="${img.filename || "image"}" />`;
    })
    .join("");
  return `
    <article class="bubble">
      <div class="meta"><span>${time}</span>${badges}</div>
      <p>${escapeHtml(msg.text || "(image)")}</p>
      ${imgs ? `<div class="thumbs">${imgs}</div>` : ""}
    </article>
  `;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function refresh() {
  if (!token()) {
    els.statusPill.textContent = "set token to send";
    els.statusPill.className = "status warn";
    return;
  }
  try {
    const [status, messages] = await Promise.all([
      api("/v1/status"),
      api(`/v1/messages?sessionId=${encodeURIComponent(sessionId)}`),
    ]);
    const awaiting = status.awaitingMore?.length || 0;
    const ready = status.readyPrompts || 0;
    els.statusPill.textContent =
      awaiting > 0
        ? `awaiting ×${awaiting}`
        : ready > 0
          ? `ready ×${ready}`
          : `idle · ${status.pendingMessages || 0} pending`;
    els.statusPill.className =
      "status " + (awaiting ? "warn" : ready ? "ok" : "");

    const rows = messages.messages || [];
    if (!rows.length) {
      els.thread.innerHTML = `<div class="empty">Send a message or photo.<br/>Cursor agents poll via MCP <code>agent_debug_poll</code>.</div>`;
      return;
    }
    els.thread.innerHTML = rows.map(bubbleHtml).join("");
    els.thread.scrollTop = els.thread.scrollHeight;

    if (status.awaitingMore?.[0]) {
      const a = status.awaitingMore[0];
      els.thread.insertAdjacentHTML(
        "beforeend",
        `<article class="bubble system"><div class="meta"><span class="badge await">holding batch</span></div><p>${escapeHtml(a.reason || "awaiting more")} · until ${escapeHtml(a.until || "—")}</p></article>`,
      );
      els.thread.scrollTop = els.thread.scrollHeight;
    }
  } catch (err) {
    els.statusPill.textContent = `error: ${err.message}`;
    els.statusPill.className = "status warn";
  }
}

async function send({ sendNow = false } = {}) {
  persistToken();
  if (!token()) {
    alert("Paste AGENT_DEBUG_TOKEN in the Token field first.");
    els.tokenInput.focus();
    return;
  }
  const text = els.textInput.value.trim();
  if (!text && !pendingFiles.length) return;
  els.sendBtn.dataset.busy = "1";
  syncSendEnabled();
  try {
    if (pendingFiles.length) {
      const fd = new FormData();
      for (const file of pendingFiles) fd.append("file", file);
      fd.append("sessionId", sessionId);
      fd.append("text", text);
      fd.append("urgent", String(els.urgentToggle.checked));
      fd.append("sendNow", String(sendNow));
      // Do not set Content-Type — browser must add multipart boundary.
      const res = await fetch("/v1/upload", {
        method: "POST",
        headers: authHeaders(false),
        body: fd,
      });
      if (!res.ok) {
        const t = await res.text();
        let err = t.slice(0, 200);
        try {
          err = JSON.parse(t)?.error || err;
        } catch {
          /* keep slice */
        }
        throw new Error(err);
      }
      const data = await res.json();
      if (data.message?.sessionId) {
        sessionId = data.message.sessionId;
        localStorage.setItem(SESSION_KEY, sessionId);
      }
    } else {
      const data = await api("/v1/messages", {
        method: "POST",
        body: JSON.stringify({
          sessionId,
          text,
          urgent: els.urgentToggle.checked,
          sendNow,
        }),
      });
      if (data.message?.sessionId) {
        sessionId = data.message.sessionId;
        localStorage.setItem(SESSION_KEY, sessionId);
      }
    }
    els.textInput.value = "";
    pendingFiles = [];
    renderPreviews();
    await refresh();
  } catch (err) {
    alert(`Send failed: ${err.message}`);
  } finally {
    els.sendBtn.dataset.busy = "0";
    syncSendEnabled();
  }
}

els.tokenInput.addEventListener("input", persistToken);
els.tokenInput.addEventListener("change", persistToken);

els.fileInput.addEventListener("change", () => {
  pendingFiles.push(...Array.from(els.fileInput.files || []));
  els.fileInput.value = "";
  renderPreviews();
});

els.sendBtn.addEventListener("click", () => send({ sendNow: false }));
els.composeBtn.addEventListener("click", async () => {
  if (els.textInput.value.trim() || pendingFiles.length) {
    await send({ sendNow: true });
  }
  if (!token()) return;
  try {
    await api("/v1/compose-now", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    await refresh();
  } catch (err) {
    alert(err.message);
  }
});

els.textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send({ sendNow: false });
  }
});

window.addEventListener("paste", (e) => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) pendingFiles.push(file);
    }
  }
  if (pendingFiles.length) renderPreviews();
});

syncSendEnabled();
refresh();
setInterval(refresh, 4000);
