const SESSION_KEY = "agent-debug-session";
const TOKEN_KEY = "agent-debug-token";
const TOKEN_COLLAPSED_KEY = "agent-debug-token-collapsed";

const els = {
  thread: document.getElementById("thread"),
  threadWrap: document.getElementById("threadWrap"),
  pullIndicator: document.getElementById("pullIndicator"),
  textInput: document.getElementById("textInput"),
  fileInput: document.getElementById("fileInput"),
  cameraInput: document.getElementById("cameraInput"),
  sendBtn: document.getElementById("sendBtn"),
  composeBtn: document.getElementById("composeBtn"),
  composeBtnMobile: document.getElementById("composeBtnMobile"),
  urgentToggle: document.getElementById("urgentToggle"),
  urgentToggleMobile: document.getElementById("urgentToggleMobile"),
  tokenInput: document.getElementById("tokenInput"),
  tokenField: document.getElementById("tokenField"),
  tokenLockBtn: document.getElementById("tokenLockBtn"),
  tokenRow: document.querySelector(".token-row"),
  statusStrip: document.getElementById("statusStrip"),
  statusLabel: document.getElementById("statusLabel"),
  previews: document.getElementById("previews"),
  refreshBtn: document.getElementById("refreshBtn"),
  readyToggleBtn: document.getElementById("readyToggleBtn"),
  readyBadge: document.getElementById("readyBadge"),
  readySheet: document.getElementById("readySheet"),
  readyBackdrop: document.getElementById("readyBackdrop"),
  readyCloseBtn: document.getElementById("readyCloseBtn"),
  readyList: document.getElementById("readyList"),
  archivedSection: document.getElementById("archivedSection"),
  archivedList: document.getElementById("archivedList"),
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
let tokenCollapsed = localStorage.getItem(TOKEN_COLLAPSED_KEY) === "1";
let readySheetOpen = false;
let pullStartY = 0;
let pullDistance = 0;
let isRefreshing = false;
let shouldStickToBottom = true;

function token() {
  return els.tokenInput.value.trim();
}

function persistToken() {
  localStorage.setItem(TOKEN_KEY, token());
  syncSendEnabled();
  if (token()) {
    tokenCollapsed = true;
    localStorage.setItem(TOKEN_COLLAPSED_KEY, "1");
  }
  syncTokenUi();
}

function syncTokenUi() {
  const hasToken = Boolean(token());
  const collapsed = hasToken && tokenCollapsed;
  els.tokenRow?.classList.toggle("collapsed", collapsed);
  els.tokenLockBtn?.setAttribute("aria-expanded", collapsed ? "false" : "true");
  els.tokenLockBtn?.setAttribute(
    "aria-label",
    collapsed ? "Token saved — tap to edit" : "Hide token field",
  );
}

function expandToken() {
  tokenCollapsed = false;
  localStorage.setItem(TOKEN_COLLAPSED_KEY, "0");
  syncTokenUi();
  els.tokenInput.focus();
}

function syncSendEnabled() {
  const hasToken = Boolean(token());
  const busy = els.sendBtn.dataset.busy === "1";
  els.sendBtn.disabled = busy || !hasToken;
  els.composeBtn.disabled = busy || !hasToken;
  els.composeBtnMobile.disabled = busy || !hasToken;
  const title = hasToken ? "" : "Paste AGENT_DEBUG_TOKEN above first";
  els.sendBtn.title = title;
  els.composeBtn.title = title;
  els.composeBtnMobile.title = title;
}

function syncUrgentToggles(source) {
  const checked =
    source === "mobile"
      ? els.urgentToggleMobile.checked
      : els.urgentToggle.checked;
  els.urgentToggle.checked = checked;
  els.urgentToggleMobile.checked = checked;
}

function setStatus(kind, label, detail = "") {
  els.statusStrip.className = `status-strip ${kind || ""}`.trim();
  els.statusLabel.textContent = label;
  els.statusStrip.title = detail || label;
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

function isNearBottom(el, threshold = 80) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

function scrollThreadToBottom(behavior = "smooth") {
  if (!shouldStickToBottom) return;
  const el = els.thread;
  if (behavior === "auto") {
    el.scrollTop = el.scrollHeight;
    return;
  }
  el.scrollTo({ top: el.scrollHeight, behavior });
}

function renderPreviews() {
  els.previews.innerHTML = "";
  pendingFiles.forEach((file, idx) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.dataset.idx = String(idx);

    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.alt = file.name;

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "chip-remove";
    rm.setAttribute("aria-label", `Remove ${file.name || "image"}`);
    rm.textContent = "×";
    rm.addEventListener("click", () => removePreview(idx));

    attachSwipeToRemove(chip, idx);
    chip.append(img, rm);
    els.previews.append(chip);
  });
}

function removePreview(idx) {
  pendingFiles.splice(idx, 1);
  renderPreviews();
}

function attachSwipeToRemove(chip, idx) {
  let startX = 0;
  let currentX = 0;
  let swiping = false;

  chip.addEventListener(
    "touchstart",
    (e) => {
      startX = e.touches[0].clientX;
      currentX = startX;
      swiping = true;
    },
    { passive: true },
  );

  chip.addEventListener(
    "touchmove",
    (e) => {
      if (!swiping) return;
      currentX = e.touches[0].clientX;
      const dx = currentX - startX;
      if (Math.abs(dx) > 8) {
        chip.style.transform = `translateX(${dx}px)`;
        chip.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 120));
      }
    },
    { passive: true },
  );

  chip.addEventListener("touchend", () => {
    if (!swiping) return;
    swiping = false;
    const dx = currentX - startX;
    chip.style.transform = "";
    chip.style.opacity = "";
    if (Math.abs(dx) > 72) removePreview(idx);
  });
}

function bubbleDirection(msg) {
  if (msg.status === "composed" || msg.status === "acked") return "incoming";
  return "outgoing";
}

function formatDateHeader(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatStepTime(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dismissSafetyLabel(safety) {
  switch (safety) {
    case "wait":
      return "Wait";
    case "caution":
      return "Hold";
    case "safe":
      return "OK to dismiss";
    case "done":
      return "Archived";
    default:
      return "";
  }
}

function lifecycleStepperHtml(lifecycle, { vertical = true } = {}) {
  if (!lifecycle?.steps?.length) return "";
  const mode = vertical ? "pipeline-vsteps" : "lifecycle-stepper";
  const steps = lifecycle.steps
    .map((step) => {
      const classes = [
        vertical ? "pipeline-vstep" : "lifecycle-step",
        step.reached ? "reached" : "",
        step.active ? "active" : "",
        step.stage,
      ]
        .filter(Boolean)
        .join(" ");
      const time = step.at ? `<time>${escapeHtml(formatStepTime(step.at))}</time>` : "";
      if (vertical) {
        return `<li class="${classes}"><span class="step-rail" aria-hidden="true"><span class="step-dot"></span></span><span class="step-body"><span class="step-label">${escapeHtml(step.label)}</span>${time}</span></li>`;
      }
      return `<li class="${classes}"><span class="step-dot" aria-hidden="true"></span><span class="step-label">${escapeHtml(step.label)}</span>${time}</li>`;
    })
    .join("");
  return `<ol class="${mode}" aria-label="Prompt pipeline">${steps}</ol>`;
}

function promptPreviewHtml(item) {
  const preview = item.composedPromptPreview || item.promptPreview;
  if (!preview) return "";
  const full = item.prompt || preview;
  const truncated = preview.length < (full?.length || 0);
  return `<details class="prompt-preview"${truncated ? "" : " open"}>
    <summary>Composed prompt</summary>
    <pre>${escapeHtml(preview)}${truncated ? "\n…" : ""}</pre>
  </details>`;
}

function pipelinePanelHtml(lifecycle, item = {}) {
  if (!lifecycle) return "";
  const safety = lifecycle.dismissSafety || "wait";
  const steps = lifecycleStepperHtml(lifecycle, { vertical: true });
  const hint = lifecycle.dismissHint
    ? `<p class="pipeline-hint">${escapeHtml(lifecycle.dismissHint)}</p>`
    : "";
  const warn = lifecycle.doneWarning
    ? `<p class="lifecycle-warn" role="status">${escapeHtml(lifecycle.doneWarning)}</p>`
    : "";
  const deployNote =
    lifecycle.deployNote && lifecycle.deployStatus === "live"
      ? `<p class="lifecycle-deploy-note">${escapeHtml(lifecycle.deployNote)}</p>`
      : "";
  const ids = cursorIdsHtml({ ...lifecycle, ...item });
  const preview = promptPreviewHtml(item);
  return `<section class="pipeline-card stage-${escapeAttr(lifecycle.current)}" aria-label="Prompt status">
    <header class="pipeline-head">
      <span class="dismiss-safety ${escapeAttr(safety)}">${escapeHtml(dismissSafetyLabel(safety))}</span>
      <strong class="pipeline-headline">${escapeHtml(lifecycle.headline || lifecycle.current.replaceAll("_", " "))}</strong>
    </header>
    ${steps}
    ${hint}${warn}${deployNote}${ids}${preview}
  </section>`;
}

function lifecyclePillHtml(lifecycle) {
  if (!lifecycle) return "";
  const label = lifecycle.headline
    ? lifecycle.headline.split("—")[0].trim()
    : lifecycle.current.replaceAll("_", " ");
  return `<span class="badge lifecycle ${escapeAttr(lifecycle.current)}" title="${escapeAttr(lifecycle.headline || "")}">${escapeHtml(label)}</span>`;
}

function bubbleHtml(msg) {
  const time = new Date(msg.createdAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const dir = bubbleDirection(msg);
  const lifecycle = msg.lifecycle;
  const badges = [
    lifecycle ? lifecyclePillHtml(lifecycle) : `<span class="badge ${escapeAttr(msg.status)}">${escapeHtml(msg.status)}</span>`,
    msg.urgent ? `<span class="badge urgent">urgent</span>` : "",
  ]
    .filter(Boolean)
    .join("");
  const imgs = (msg.images || [])
    .map((img) => {
      const src = img.thumbUrl || img.url;
      if (!src) return "";
      const q = token() ? `?token=${encodeURIComponent(token())}` : "";
      return `<img src="${src}${q}" alt="${escapeAttr(img.filename || "image")}" loading="lazy" />`;
    })
    .join("");
  const pipeline = lifecycle ? pipelinePanelHtml(lifecycle, msg) : "";
  const ids = "";
  const canAck = lifecycle?.canAck && msg.batchId;
  const doneDisabled = lifecycle && !lifecycle.canAck;
  const doneTitle = lifecycle?.doneWarning || "";
  const actions = canAck
    ? `<div class="bubble-actions">
        ${lifecycle?.canMarkLive ? `<button type="button" class="btn pill live" data-mark-live="${escapeAttr(msg.batchId)}" aria-label="Mark deployed live">Mark live</button>` : ""}
        <button type="button" class="btn pill done" data-ack-done="${escapeAttr(msg.batchId)}" aria-label="Mark implemented"${doneDisabled ? " disabled" : ""}${doneTitle ? ` title="${escapeAttr(doneTitle)}"` : ""}>Done</button>
        <button type="button" class="btn pill ghost danger" data-ack-discard="${escapeAttr(msg.batchId)}" aria-label="Discard prompt">Discard</button>
      </div>`
    : "";
  return `
    <article class="bubble ${dir === "incoming" ? "incoming" : ""} stage-${escapeAttr(lifecycle?.current || msg.status)}" data-batch-id="${escapeAttr(msg.batchId || "")}">
      <div class="meta"><span>${escapeHtml(time)}</span>${badges}</div>
      ${pipeline}
      <p>${escapeHtml(msg.text || "(image)")}</p>
      ${imgs ? `<div class="thumbs">${imgs}</div>` : ""}
      ${actions}
    </article>
  `;
}

function readyCardHtml(p, { showFullPrompt = false } = {}) {
  const time = p.readyAt || p.lifecycle?.composedAt
    ? new Date(p.readyAt || p.lifecycle.composedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
  const urgent = p.urgent ? `<span class="badge urgent">urgent</span>` : "";
  const lifecycle = p.lifecycle;
  const previewLen = showFullPrompt ? 2000 : 400;
  const preview = (p.prompt || "(no prompt text)").slice(0, previewLen);
  const pipeline = lifecycle ? pipelinePanelHtml(lifecycle, p) : "";
  const doneDisabled = lifecycle && !lifecycle.canAck;
  const doneTitle = lifecycle?.doneWarning || "";
  const markLive =
    lifecycle?.canMarkLive
      ? `<button type="button" class="btn pill live" data-mark-live="${escapeAttr(p.batchId)}" aria-label="Mark deployed live">Mark live</button>`
      : "";
  const liveBadge =
    lifecycle?.deployStatus === "live"
      ? `<span class="badge deployed">live</span>`
      : "";
  return `
    <article class="ready-card stage-${escapeAttr(lifecycle?.current || "ready")}" data-batch-id="${escapeAttr(p.batchId)}">
      <div class="meta">
        <span>${escapeHtml(time)}</span>
        ${urgent}
        ${lifecycle ? lifecyclePillHtml(lifecycle) : ""}
        ${liveBadge}
      </div>
      ${pipeline}
      <p class="ready-snippet">${escapeHtml(preview)}${(p.prompt || "").length > previewLen ? "…" : ""}</p>
      <div class="bubble-actions">
        ${markLive}
        <button type="button" class="btn pill done" data-ack-done="${escapeAttr(p.batchId)}" aria-label="Mark implemented"${doneDisabled ? " disabled" : ""}${doneTitle ? ` title="${escapeAttr(doneTitle)}"` : ""}>Done</button>
        <button type="button" class="btn pill ghost danger" data-ack-discard="${escapeAttr(p.batchId)}" aria-label="Discard prompt">Discard</button>
      </div>
    </article>
  `;
}

function renderThread(rows) {
  let html = "";
  let lastDate = "";

  for (const msg of rows) {
    const dateKey = msg.createdAt.slice(0, 10);
    if (dateKey !== lastDate) {
      html += `<div class="date-header">${escapeHtml(formatDateHeader(msg.createdAt))}</div>`;
      lastDate = dateKey;
    }
    html += bubbleHtml(msg);
  }

  return html;
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(s) {
  return escapeHtml(s).replaceAll('"', "&quot;");
}

async function copyText(text, btn) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const prev = btn.textContent;
    btn.textContent = "Copied";
    setTimeout(() => {
      btn.textContent = prev;
    }, 1200);
  } catch {
    prompt("Copy:", text);
  }
}

function cursorIdsHtml(item) {
  const parts = [];
  if (item.cursorAgentId) {
    parts.push(
      `<span class="cursor-id" title="Cursor agent id"><code>${escapeHtml(item.cursorAgentId)}</code><button type="button" class="btn copy-id" data-copy="${escapeAttr(item.cursorAgentId)}" aria-label="Copy agent id">⧉</button></span>`,
    );
  }
  if (item.cursorRunId) {
    parts.push(
      `<span class="cursor-id" title="Cursor run id"><code>${escapeHtml(item.cursorRunId)}</code><button type="button" class="btn copy-id" data-copy="${escapeAttr(item.cursorRunId)}" aria-label="Copy run id">⧉</button></span>`,
    );
  }
  if (item.cursorTranscriptHint) {
    parts.push(
      `<span class="cursor-id transcript-hint" title="Local transcript hint"><code>${escapeHtml(item.cursorTranscriptHint)}</code><button type="button" class="btn copy-id" data-copy="${escapeAttr(item.cursorTranscriptHint)}" aria-label="Copy transcript path">⧉</button></span>`,
    );
  }
  if (!parts.length) return "";
  return `<div class="cursor-ids">${parts.join("")}</div>`;
}

function wireCopyButtons(root) {
  root.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      copyText(btn.getAttribute("data-copy"), btn);
    });
  });
}

async function ackBatch(batchId, reason, { force = false, warning = "" } = {}) {
  if (!force && warning && reason === "implemented") {
    const ok = confirm(`${warning}\n\nMark as implemented anyway?`);
    if (!ok) throw new Error("cancelled");
  }
  await api("/v1/ack", {
    method: "POST",
    body: JSON.stringify({ batchId, reason }),
  });
}

async function markLive(batchId) {
  const note = prompt("Optional deploy note (e.g. VPS wave, commit):", "") ?? "";
  await api("/v1/mark-deployed", {
    method: "POST",
    body: JSON.stringify({ batchId, deployNote: note.trim() || undefined, deployStatus: "live" }),
  });
}

function wireMarkLiveButtons(root) {
  root.querySelectorAll("[data-mark-live]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-mark-live");
      if (!id) return;
      btn.disabled = true;
      try {
        await markLive(id);
        await refresh({ forceBottom: true });
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

function wireAckButtons(root) {
  root.querySelectorAll("[data-ack-done]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-ack-done");
      if (!id || btn.disabled) return;
      const card = btn.closest("[data-batch-id]");
      const warnEl = card?.querySelector(".lifecycle-warn");
      const warning = warnEl?.textContent || btn.getAttribute("title") || "";
      btn.disabled = true;
      try {
        await ackBatch(id, "implemented", { warning });
        await refresh({ forceBottom: true });
      } catch (err) {
        if (err.message !== "cancelled") alert(err.message);
        btn.disabled = false;
      }
    });
  });
  root.querySelectorAll("[data-ack-discard]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-ack-discard");
      if (!id) return;
      btn.disabled = true;
      try {
        await ackBatch(id, "discarded");
        await refresh({ forceBottom: true });
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
      }
    });
  });
}

function renderReadySheet(prompts) {
  const count = prompts.length;
  els.readyToggleBtn.hidden = count === 0;
  els.readyToggleBtn.classList.toggle("has-ready", count > 0);
  els.readyBadge.hidden = count === 0;
  els.readyBadge.textContent = String(count);
  els.readyToggleBtn.setAttribute(
    "aria-label",
    count ? `${count} ready prompt${count === 1 ? "" : "s"}` : "Show ready prompts",
  );

  if (!count) {
    els.readyList.innerHTML = `<p class="ready-empty">No prompts waiting for ack.</p>`;
    return;
  }

  els.readyList.innerHTML = prompts.map((p) => readyCardHtml(p)).join("");

  wireAckButtons(els.readyList);
  wireMarkLiveButtons(els.readyList);
  wireCopyButtons(els.readyList);
}

function renderArchivedSheet(archived) {
  const rows = archived?.archivedBatches || [];
  if (!rows.length) {
    els.archivedSection.hidden = true;
    els.archivedList.innerHTML = "";
    return;
  }

  els.archivedSection.hidden = false;
  els.archivedList.innerHTML = rows
    .map((p) => {
      const time = p.ackedAt
        ? new Date(p.ackedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
        : "—";
      const reason = p.ackReason
        ? `<span class="badge ${escapeAttr(p.ackReason)}">${escapeHtml(p.ackReason.replaceAll("_", " "))}</span>`
        : "";
      const pipeline = p.lifecycle ? pipelinePanelHtml(p.lifecycle, p) : "";
      const preview = (p.promptPreview || "").slice(0, 160);
      return `
        <article class="ready-card archived-card stage-${escapeAttr(p.lifecycle?.current || "done")}">
          <div class="meta">
            <span>${escapeHtml(time)}</span>
            ${reason}
            ${p.lifecycle ? lifecyclePillHtml(p.lifecycle) : ""}
          </div>
          ${pipeline}
          <p class="ready-snippet">${escapeHtml(preview || "(archived)")}${(p.promptPreview || "").length > 160 ? "…" : ""}</p>
        </article>
      `;
    })
    .join("");

  wireCopyButtons(els.archivedList);
}

function openReadySheet() {
  readySheetOpen = true;
  els.readySheet.hidden = false;
  els.readyBackdrop.hidden = false;
  requestAnimationFrame(() => els.readySheet.classList.add("open"));
  els.readyToggleBtn.setAttribute("aria-expanded", "true");
}

function closeReadySheet() {
  readySheetOpen = false;
  els.readySheet.classList.remove("open");
  els.readyToggleBtn.setAttribute("aria-expanded", "false");
  setTimeout(() => {
    if (!readySheetOpen) {
      els.readySheet.hidden = true;
      els.readyBackdrop.hidden = true;
    }
  }, 280);
}

function countPipelineStages(messages, pending) {
  const batches = new Map();
  for (const msg of messages) {
    if (msg.lifecycle?.batchId) batches.set(msg.lifecycle.batchId, msg.lifecycle);
  }
  for (const p of pending?.readyPrompts || []) {
    if (p.lifecycle) batches.set(p.lifecycle.batchId, p.lifecycle);
  }
  for (const ob of pending?.openBatches || []) {
    if (ob.lifecycle) batches.set(ob.lifecycle.batchId, ob.lifecycle);
  }
  const counts = { sent: 0, composing: 0, ready: 0, dispatched: 0, implemented: 0, deployed: 0 };
  for (const lc of batches.values()) {
    if (lc.current in counts) counts[lc.current] += 1;
  }
  return counts;
}

function buildStatusLabel(status, pipelineCounts) {
  const awaiting = status.awaitingMore?.length || 0;
  const ready = status.readyPrompts || 0;
  const dispatched = status.dispatchedPrompts || 0;
  const sdk = status.sdkDispatchEnabled;
  const prompted = pipelineCounts?.dispatched || 0;
  const composed = pipelineCounts?.ready || 0;

  if (awaiting > 0) return { kind: "warn", label: `holding ×${awaiting}` };
  if (prompted > 0) return { kind: "dispatch", label: `in Cursor ×${prompted}` };
  if (composed > 0) return { kind: "ok", label: sdk ? `composed ×${composed}` : `composed ×${composed} · MCP` };
  if (dispatched > 0) return { kind: "dispatch", label: `prompted ×${dispatched}` };
  if (ready > 0) return { kind: "ok", label: sdk ? `ready ×${ready}` : `ready ×${ready} · MCP` };
  if (!sdk) return { kind: "warn", label: "MCP poll" };
  return { kind: "ok", label: "online" };
}

function buildStatusDetail(status, pipelineCounts) {
  const parts = [];
  parts.push(status.sdkDispatchEnabled ? "SDK dispatch on" : "SDK off — set CURSOR_API_KEY & restart");
  if (pipelineCounts) {
    const stages = [];
    if (pipelineCounts.composing) stages.push(`${pipelineCounts.composing} composing`);
    if (pipelineCounts.ready) stages.push(`${pipelineCounts.ready} composed`);
    if (pipelineCounts.dispatched) stages.push(`${pipelineCounts.dispatched} prompted`);
    if (pipelineCounts.deployed) stages.push(`${pipelineCounts.deployed} live`);
    if (stages.length) parts.push(stages.join(" · "));
  }
  if (status.composeModel) parts.push(`compose: ${status.composeModel}`);
  if (status.visionModel) parts.push(`vision: ${status.visionModel}`);
  if (status.pendingMessages) parts.push(`${status.pendingMessages} pending`);
  if (status.dispatchLastError) parts.push(`err: ${status.dispatchLastError.slice(0, 60)}`);
  const withIds = (status.readyDispatches || []).filter((d) => d.cursorAgentId);
  if (withIds.length) {
    const latest = withIds[0];
    parts.push(`agent: ${latest.cursorAgentId?.slice(0, 12)}…`);
  }
  return parts.join(" · ");
}

async function refresh({ forceBottom = false } = {}) {
  if (!token()) {
    setStatus("warn", "set token", "Paste AGENT_DEBUG_TOKEN to connect");
    return;
  }

  const wasNearBottom = forceBottom || isNearBottom(els.thread);

  try {
    const [status, messages, pending, archive] = await Promise.all([
      api("/v1/status"),
      api(`/v1/messages?sessionId=${encodeURIComponent(sessionId)}`),
      api("/v1/pending"),
      api("/v1/archive?limit=8"),
    ]);
    const rows = messages.messages || [];
    const pipelineCounts = countPipelineStages(rows, pending);
    const { kind, label } = buildStatusLabel(status, pipelineCounts);
    setStatus(kind, label, buildStatusDetail(status, pipelineCounts));

    renderReadySheet(pending.readyPrompts || []);
    renderArchivedSheet(archive);

    if (!rows.length) {
      els.thread.innerHTML = `<div class="empty">Send a note or photo from the balcony.<br/><strong>Pipeline:</strong> Sent → Composed → Prompted → Implemented → Live<br/>Each bubble shows where it is and whether it is safe to dismiss.</div>`;
    } else {
      els.thread.innerHTML = renderThread(rows);
      wireAckButtons(els.thread);
      wireMarkLiveButtons(els.thread);
      wireCopyButtons(els.thread);
    }

    for (const ob of pending.openBatches || []) {
      if (!ob.lifecycle || ob.lifecycle.current === "sent") continue;
      els.thread.insertAdjacentHTML(
        "beforeend",
        `<article class="bubble system stage-${escapeAttr(ob.lifecycle.current)}"><div class="meta"><span class="badge await">${escapeHtml(ob.state)}</span></div>${pipelinePanelHtml(ob.lifecycle, ob)}<p>${escapeHtml(ob.composeError || ob.awaitingReason || "Batch in progress")}</p></article>`,
      );
    }

    if (status.awaitingMore?.[0]) {
      const a = status.awaitingMore[0];
      els.thread.insertAdjacentHTML(
        "beforeend",
        `<article class="bubble system"><div class="meta"><span class="badge await">holding batch</span></div><p>${escapeHtml(a.reason || "awaiting more")} · until ${escapeHtml(a.until || "—")}</p></article>`,
      );
    }

    shouldStickToBottom = wasNearBottom;
    if (wasNearBottom) scrollThreadToBottom(forceBottom ? "auto" : "smooth");
  } catch (err) {
    setStatus("warn", "offline", err.message);
  }
}

async function send({ sendNow = false } = {}) {
  persistToken();
  if (!token()) {
    alert("Paste AGENT_DEBUG_TOKEN in the Token field first.");
    expandToken();
    return;
  }
  const text = els.textInput.value.trim();
  if (!text && !pendingFiles.length) return;
  els.sendBtn.dataset.busy = "1";
  syncSendEnabled();
  shouldStickToBottom = true;
  try {
    if (pendingFiles.length) {
      const fd = new FormData();
      for (const file of pendingFiles) fd.append("file", file);
      fd.append("sessionId", sessionId);
      fd.append("text", text);
      fd.append("urgent", String(els.urgentToggle.checked));
      fd.append("sendNow", String(sendNow));
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
    await refresh({ forceBottom: true });
  } catch (err) {
    alert(`Send failed: ${err.message}`);
  } finally {
    els.sendBtn.dataset.busy = "0";
    syncSendEnabled();
  }
}

async function composeNow() {
  if (els.textInput.value.trim() || pendingFiles.length) {
    await send({ sendNow: true });
  }
  if (!token()) return;
  try {
    await api("/v1/compose-now", {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
    await refresh({ forceBottom: true });
  } catch (err) {
    alert(err.message);
  }
}

async function manualRefresh() {
  if (isRefreshing) return;
  isRefreshing = true;
  els.refreshBtn.classList.add("spinning");
  els.refreshBtn.disabled = true;
  els.pullIndicator.classList.add("visible", "refreshing");
  try {
    await refresh({ forceBottom: false });
  } finally {
    isRefreshing = false;
    els.refreshBtn.classList.remove("spinning");
    els.refreshBtn.disabled = false;
    els.pullIndicator.classList.remove("visible", "refreshing");
    pullDistance = 0;
  }
}

els.tokenInput.addEventListener("input", persistToken);
els.tokenInput.addEventListener("change", persistToken);
els.tokenLockBtn.addEventListener("click", () => {
  if (els.tokenRow.classList.contains("collapsed")) expandToken();
  else {
    tokenCollapsed = true;
    localStorage.setItem(TOKEN_COLLAPSED_KEY, "1");
    syncTokenUi();
  }
});

els.urgentToggle.addEventListener("change", () => syncUrgentToggles("desktop"));
els.urgentToggleMobile.addEventListener("change", () => syncUrgentToggles("mobile"));

function watchTokenAutofill() {
  const input = els.tokenInput;
  let last = input.value;

  function syncIfChanged() {
    if (input.value === last) return;
    const hadToken = Boolean(last.trim());
    last = input.value;
    persistToken();
    if (!hadToken && token()) refresh({ forceBottom: true });
  }

  input.addEventListener("animationstart", (e) => {
    if (e.animationName === "onAutoFillStart") syncIfChanged();
  });

  let pollTimer = null;
  function pollFor(ms = 2500, interval = 120) {
    clearInterval(pollTimer);
    const end = Date.now() + ms;
    pollTimer = setInterval(() => {
      syncIfChanged();
      if (Date.now() >= end) clearInterval(pollTimer);
    }, interval);
  }

  input.addEventListener("focus", () => pollFor());
  window.addEventListener("pageshow", () => pollFor());
  pollFor(3000, 150);
}

watchTokenAutofill();

function addFilesFromInput(input) {
  pendingFiles.push(...Array.from(input.files || []));
  input.value = "";
  renderPreviews();
}

els.fileInput.addEventListener("change", () => addFilesFromInput(els.fileInput));
els.cameraInput.addEventListener("change", () => addFilesFromInput(els.cameraInput));

els.sendBtn.addEventListener("click", () => send({ sendNow: false }));
els.composeBtn.addEventListener("click", composeNow);
els.composeBtnMobile.addEventListener("click", composeNow);
els.refreshBtn.addEventListener("click", manualRefresh);

els.readyToggleBtn.addEventListener("click", () => {
  if (readySheetOpen) closeReadySheet();
  else openReadySheet();
});
els.readyCloseBtn.addEventListener("click", closeReadySheet);
els.readyBackdrop.addEventListener("click", closeReadySheet);

els.textInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send({ sendNow: false });
  }
});

els.thread.addEventListener("scroll", () => {
  shouldStickToBottom = isNearBottom(els.thread);
});

els.threadWrap.addEventListener(
  "touchstart",
  (e) => {
    if (els.thread.scrollTop <= 0 && !isRefreshing) {
      pullStartY = e.touches[0].clientY;
      pullDistance = 0;
    } else {
      pullStartY = 0;
    }
  },
  { passive: true },
);

els.threadWrap.addEventListener(
  "touchmove",
  (e) => {
    if (!pullStartY || isRefreshing) return;
    if (els.thread.scrollTop > 0) {
      pullStartY = 0;
      return;
    }
    pullDistance = Math.max(0, e.touches[0].clientY - pullStartY);
    if (pullDistance > 8) {
      els.pullIndicator.classList.add("visible");
      els.pullIndicator.querySelector("span").textContent =
        pullDistance > 72 ? "Release to refresh" : "Pull to refresh";
    }
  },
  { passive: true },
);

els.threadWrap.addEventListener("touchend", () => {
  if (pullDistance > 72 && !isRefreshing) manualRefresh();
  else {
    els.pullIndicator.classList.remove("visible");
    pullDistance = 0;
  }
  pullStartY = 0;
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

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && readySheetOpen) closeReadySheet();
});

syncTokenUi();
syncSendEnabled();
refresh({ forceBottom: true });
setInterval(() => refresh(), 4000);
