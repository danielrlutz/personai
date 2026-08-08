"use client";

import Link from "next/link";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { BriefingSnapshot } from "@/lib/api-client";

interface BriefingActionItemsProps {
  snapshot: BriefingSnapshot;
}

export function BriefingActionItems({ snapshot }: BriefingActionItemsProps) {
  const actions: Array<{ label: string; href: string; done?: boolean; priority?: "high" | "normal" }> = [];

  snapshot.finance.billsDueToday.forEach((bill) => {
    actions.push({
      label: `Pay ${bill.creditor} (${bill.amount.toFixed(2)} CHF)`,
      href: "/finance",
      priority: "high",
    });
  });

  snapshot.legal.tasksDueToday.forEach((task) => {
    actions.push({
      label: task.title,
      href: "/legal",
      priority: "high",
    });
  });

  if (snapshot.ingest.queuedJobs > 0) {
    actions.push({
      label: `Review ${snapshot.ingest.queuedJobs} queued ingestion job(s)`,
      href: "/ingest",
    });
  }

  if (snapshot.legal.overdueTasks > 0) {
    actions.push({
      label: `Resolve ${snapshot.legal.overdueTasks} overdue legal task(s)`,
      href: "/legal",
      priority: "high",
    });
  }

  if (actions.length === 0) {
    actions.push({
      label: "All caught up — review your dashboard",
      href: "/dashboard",
      done: true,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Action items</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {actions.slice(0, 6).map((action, i) => (
          <div
            key={i}
            className="md-list-row justify-between rounded-none border-x-0 border-t-0 px-0 first:pt-0"
          >
            <div className="flex items-center gap-3">
              {action.done ? (
                <CheckCircle2 className="h-4 w-4 text-success" />
              ) : (
                <Circle className={`h-4 w-4 ${action.priority === "high" ? "text-warning" : "text-muted-foreground"}`} />
              )}
              <span className="text-sm">{action.label}</span>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href={action.href}>
                Go <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
