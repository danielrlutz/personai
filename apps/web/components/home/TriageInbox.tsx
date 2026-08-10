"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, FileUp, MessageSquare, Sparkles, UsersRound } from "lucide-react";
import { apiPost } from "@/lib/api-client";
import { getOutbox } from "@/lib/outbox";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TriageProposal = {
  intent: string;
  specialistId: string;
  specialistLabel: string;
  confidence: number;
  summary: string;
  suggestedAction: string;
  reason: string;
};

type SpecialistOpt = { id: string; label: string; shortLabel: string };

export function TriageInbox() {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<TriageProposal | null>(null);
  const [specialists, setSpecialists] = useState<SpecialistOpt[]>([]);
  const [overrideId, setOverrideId] = useState<string | null>(null);

  const runTriage = useCallback(async (payload: { text?: string; hasFile?: boolean }) => {
    setBusy(true);
    try {
      const data = await apiPost<{ triage: TriageProposal; specialists: SpecialistOpt[] }>("/triage", payload, {
        silent: true,
      });
      setProposal(data.triage);
      setSpecialists(data.specialists);
      setOverrideId(data.triage.specialistId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Triage failed", { title: "Staff triage" });
    } finally {
      setBusy(false);
    }
  }, []);

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await getOutbox().enqueueUpload(file);
      }
      toast.success(`${files.length} file(s) queued for OCR — confirm naming before archive write.`);
      await runTriage({
        text: text.trim() || `Dropped ${files[0]!.name} for archive / OCR.`,
        hasFile: true,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not queue file");
    } finally {
      setBusy(false);
    }
  };

  const openChat = () => {
    const id = overrideId || proposal?.specialistId || "secretary";
    const q = text.trim() ? `&message=${encodeURIComponent(text.trim().slice(0, 500))}` : "";
    router.push(`/team/?specialist=${id}${q}`);
  };

  const openHuddle = () => {
    const primary = overrideId || proposal?.specialistId || "";
    const guests: string[] = [];
    if (primary && primary !== "secretary") guests.push(primary);
    const action = proposal?.suggestedAction;
    const complement =
      action === "finance"
        ? "legal_aide"
        : action === "legal"
          ? "cfo"
          : action === "medical"
            ? "bio_mechanic"
            : "";
    if (complement && !guests.includes(complement) && guests.length < 2) {
      guests.push(complement);
    }
    if (guests.length === 0) guests.push("cfo");
    const msg = text.trim()
      ? `&message=${encodeURIComponent(text.trim().slice(0, 500))}`
      : "";
    router.push(`/team/?huddle=1&guests=${guests.join(",")}${msg}`);
  };

  const openSuggested = () => {
    const action = proposal?.suggestedAction;
    if (action === "archive") {
      router.push("/ingest/");
      return;
    }
    if (action === "finance") {
      router.push("/finance/");
      return;
    }
    if (action === "legal") {
      router.push("/legal/");
      return;
    }
    if (action === "medical") {
      router.push("/medical/");
      return;
    }
    openChat();
  };

  return (
    <section className="space-y-4">
      <div className="min-w-0">
        <p className="font-display text-3xl tracking-tight text-foreground sm:text-4xl">Drop it here</p>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Paste a message, drop a PDF, or snap a photo. Staff proposes who should handle it — you override or just chat.
        </p>
      </div>

      <div
        className={cn(
          "rounded-2xl border border-border bg-card p-4 sm:p-5",
          "shadow-elev-1",
        )}
      >
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste an email, note, invoice text, Frist… or describe what you need."
          className="min-h-[140px] resize-y border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0"
        />
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-4">
          <Button
            disabled={busy || !text.trim()}
            onClick={() => void runTriage({ text: text.trim() })}
          >
            <Sparkles className="mr-1.5 h-4 w-4" />
            {busy ? "Reading…" : "Triage with Staff"}
          </Button>
          <label className="inline-flex">
            <Button type="button" variant="outline" disabled={busy} asChild>
              <span>
                <FileUp className="mr-1.5 h-4 w-4" />
                PDF / file
              </span>
            </Button>
            <input
              type="file"
              multiple
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => void onFiles(e.target.files)}
            />
          </label>
          <label className="inline-flex">
            <Button type="button" variant="outline" disabled={busy} asChild>
              <span>
                <Camera className="mr-1.5 h-4 w-4" />
                Camera
              </span>
            </Button>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => void onFiles(e.target.files)}
            />
          </label>
        </div>
      </div>

      {proposal ? (
        <div className="animate-message-in rounded-2xl border border-border bg-surface-container p-4 sm:p-5">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">Staff proposes</p>
          <p className="mt-2 font-display text-xl tracking-tight">
            {proposal.specialistLabel}
            <span className="ml-2 text-sm font-sans font-normal text-muted-foreground">
              {Math.round(proposal.confidence * 100)}% · {proposal.intent}
            </span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{proposal.reason}</p>
          {proposal.summary ? (
            <p className="mt-3 text-sm leading-relaxed text-foreground/90">{proposal.summary}</p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-muted-foreground">
              Override specialist
              <select
                className="h-10 rounded-lg border border-border bg-card px-3 text-sm text-foreground"
                value={overrideId ?? proposal.specialistId}
                onChange={(e) => setOverrideId(e.target.value)}
              >
                {specialists.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={openChat}>
              <MessageSquare className="mr-1.5 h-4 w-4" />
              Open chat
            </Button>
            <Button variant="outline" onClick={openHuddle}>
              <UsersRound className="mr-1.5 h-4 w-4" />
              Pocket huddle
            </Button>
            <Button variant="outline" onClick={openSuggested}>
              Go to {proposal.suggestedAction}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
