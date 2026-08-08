"use client";

import { useEffect, useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { streamSSE } from "@/lib/api-client";

interface BriefingNarrativeProps {
  initialNarrative?: string | null;
  tier?: string;
}

export function BriefingNarrative({ initialNarrative, tier }: BriefingNarrativeProps) {
  const [narrative, setNarrative] = useState(initialNarrative ?? "");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pro = tier === "pro";

  useEffect(() => {
    if (initialNarrative) setNarrative(initialNarrative);
  }, [initialNarrative]);

  const startStream = async () => {
    if (!pro) return;
    setStreaming(true);
    setError(null);
    setNarrative("");
    let abort: (() => void) | undefined;

    try {
      abort = await streamSSE("/briefing/stream", {
        onEvent: (event, data) => {
          if (event === "token" && typeof data === "object" && data && "token" in data) {
            setNarrative((prev) => prev + String((data as { token: string }).token));
          }
        },
        onError: (err) => setError(err.message),
        onDone: () => setStreaming(false),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stream failed");
      setStreaming(false);
    }

    return () => abort?.();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-teal-400" />
          AI Narrative
        </CardTitle>
        {pro && (
          <Button size="sm" variant="outline" onClick={() => void startStream()} disabled={streaming}>
            {streaming ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Generating...
              </>
            ) : (
              "Stream narrative"
            )}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {!pro ? (
          <p className="text-sm text-muted-foreground">
            AI narrative is available on the Pro tier. Upgrade to unlock streaming briefings.
          </p>
        ) : narrative ? (
          <div className="prose prose-invert max-w-none text-sm leading-relaxed text-muted-foreground">
            {narrative.split("\n").map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {streaming ? "Generating your personalized briefing..." : "Click stream to generate an AI narrative."}
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </CardContent>
    </Card>
  );
}
