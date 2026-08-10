import { deriveIngestPhase } from "./progress.js";

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const empty = new Set<string>();

{
  const r = deriveIngestPhase(
    { status: "QUEUED", documentId: "d1", pausedReason: "waiting_for_vram:vision" },
    empty,
  );
  assert(r.phase === "waiting_vision", `expected waiting_vision got ${r.phase}`);
}

{
  const r = deriveIngestPhase(
    {
      status: "PROCESSING",
      documentId: "d1",
      progressPhase: "ocr",
      progressDetail: "2/5",
    },
    empty,
  );
  assert(r.phase === "ocr" && r.detail === "2/5", `ocr detail: ${JSON.stringify(r)}`);
}

{
  const r = deriveIngestPhase(
    { status: "PROCESSING", documentId: "d1", pausedReason: "cancel_requested" },
    empty,
  );
  assert(r.phase === "cancelling", `expected cancelling got ${r.phase}`);
}

{
  const pending = new Set(["d1"]);
  const r = deriveIngestPhase(
    { status: "COMPLETED", documentId: "d1", progressPhase: "await_confirm" },
    pending,
  );
  assert(r.phase === "await_confirm", `expected await_confirm got ${r.phase}`);
}

{
  const r = deriveIngestPhase(
    {
      status: "COMPLETED",
      documentId: "d1",
      progressPhase: "await_confirm",
    },
    empty,
  );
  assert(r.phase === "done", `expected done without pending confirm, got ${r.phase}`);
}

console.log("ingest progress phase checks ok");
