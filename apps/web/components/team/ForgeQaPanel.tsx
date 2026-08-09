"use client";

import { useState } from "react";
import { Hammer, Loader2 } from "lucide-react";
import { streamSSE } from "@/lib/api-client";
import { describeApiFailure, describeStreamError } from "@/lib/api-errors";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmGate } from "@/components/confirm/ConfirmGate";

type LogLine = { kind: "info" | "forge" | "qa" | "ok" | "fail" | "error"; text: string };

export function ForgeQaPanel() {
  const [brief, setBrief] = useState("");
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogLine[]>([]);
  const [gateKey, setGateKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const push = (line: LogLine) => setLog((prev) => [...prev, line]);

  const run = () => {
    if (!brief.trim() || running) return;
    setRunning(true);
    setError(null);
    setLog([{ kind: "info", text: "Starting Forge → QA loop (max 3 attempts)…" }]);

    void streamSSE("/team/forge-qa/stream", {
      method: "POST",
      silent: true,
      body: { brief: brief.trim() },
      onEvent: (event, data) => {
        const d = data as Record<string, unknown>;
        if (event === "forge") {
          push({
            kind: "forge",
            text: `Forge attempt ${d.attempt}/${d.maxAttempts} (${String(d.model ?? "")})…`,
          });
        } else if (event === "token" && d.role === "forge") {
          const token = String(d.token ?? "");
          push({
            kind: "forge",
            text: token.length > 400 ? `${token.slice(0, 400)}…` : token,
          });
        } else if (event === "qa") {
          push({
            kind: "qa",
            text: `QA reviewing attempt ${d.attempt}/${d.maxAttempts}…`,
          });
        } else if (event === "qa_result") {
          const verdict = d.verdict === "pass" ? "PASS" : "FAIL";
          push({
            kind: d.verdict === "pass" ? "ok" : "fail",
            text: `QA ${verdict}: ${String(d.summary ?? "")}`,
          });
          const issues = Array.isArray(d.issues) ? d.issues.map(String) : [];
          for (const issue of issues.slice(0, 6)) {
            push({ kind: "fail", text: `• ${issue}` });
          }
        } else if (event === "ship_ready") {
          push({
            kind: "ok",
            text: "QA passed — confirm Ship code below before forge.ship runs.",
          });
          setGateKey((k) => k + 1);
        } else if (event === "exhausted") {
          push({
            kind: "fail",
            text: `Stopped after ${d.attempt} attempts without a pass. Edit the brief and retry.`,
          });
        } else if (event === "error") {
          const message = describeStreamError(data);
          setError(message);
          push({ kind: "error", text: message });
        }
      },
      onError: (err) => {
        const message = describeApiFailure(err, { path: "/team/forge-qa/stream" }).message;
        setError(message);
        push({ kind: "error", text: message });
      },
      onDone: () => {
        setRunning(false);
        setGateKey((k) => k + 1);
      },
    }).catch((err) => {
      const message = describeApiFailure(err, { path: "/team/forge-qa/stream" }).message;
      setError(message);
      setRunning(false);
    });
  };

  return (
    <div className="space-y-3">
      <ConfirmGate refreshKey={gateKey} compact />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Hammer className="h-4 w-4 text-primary" />
            Forge ↔ QA loop
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Forge proposes, QA pass/fail reviews, Forge retries up to 3 times. Ship needs your
            confirmation — nothing ships on its own.
          </p>
          <Textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            rows={5}
            placeholder="Brief for Forge (what to build or fix)…"
            className="resize-none"
            disabled={running}
          />
          {error ? <p className="text-sm text-destructive break-words">{error}</p> : null}
          <Button size="sm" disabled={running || !brief.trim()} onClick={run}>
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              "Run Forge → QA"
            )}
          </Button>
          {log.length > 0 ? (
            <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl bg-surface-container/50 p-3 text-xs leading-relaxed">
              {log.map((line, i) => (
                <p
                  key={`${i}-${line.kind}`}
                  className={
                    line.kind === "error" || line.kind === "fail"
                      ? "text-destructive break-words whitespace-pre-wrap"
                      : line.kind === "ok"
                        ? "text-foreground break-words whitespace-pre-wrap"
                        : "text-muted-foreground break-words whitespace-pre-wrap"
                  }
                >
                  {line.text}
                </p>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
