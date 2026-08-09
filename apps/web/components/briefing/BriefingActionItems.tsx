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

  snapshot.personal?.tasksDueToday.forEach((task) => {
    actions.push({
      label: task.title,
      href: "/life",
      priority: "high",
    });
  });

  snapshot.personal?.habitsPending.forEach((habit) => {
    actions.push({
      label: `Log habit: ${habit.title}`,
      href: "/life",
    });
  });

  snapshot.personal?.touchpointsDue.forEach((tp) => {
    actions.push({
      label: `Reach out to ${tp.contactName}`,
      href: "/life",
    });
  });

  if (snapshot.personal && snapshot.personal.overdueTasks > 0) {
    actions.push({
      label:
        snapshot.personal.overdueTasks === 1
          ? "Resolve 1 overdue personal task"
          : `Resolve ${snapshot.personal.overdueTasks} overdue personal tasks`,
      href: "/life",
      priority: "high",
    });
  }

  if (snapshot.ingest.queuedJobs > 0) {
    actions.push({
      label:
        snapshot.ingest.queuedJobs === 1
          ? "Review 1 document in the archive queue"
          : `Review ${snapshot.ingest.queuedJobs} documents in the archive queue`,
      href: "/ingest",
    });
  }

  if (snapshot.legal.overdueTasks > 0) {
    actions.push({
      label:
        snapshot.legal.overdueTasks === 1
          ? "Resolve 1 overdue legal task"
          : `Resolve ${snapshot.legal.overdueTasks} overdue legal tasks`,
      href: "/legal",
      priority: "high",
    });
  }

  if (actions.length === 0) {
    actions.push({
      label: "All caught up — review your dashboard",
      href: "/dashboard/",
      done: true,
    });
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Action items</CardTitle>
      </CardHeader>
      <CardContent>
        {actions.slice(0, 6).map((action, i) => (
          <div
            key={i}
            className="md-list-row justify-between rounded-none border-x-0 border-t-0 px-0 py-2.5 first:pt-0"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              {action.done ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
              ) : (
                <Circle
                  className={`h-4 w-4 shrink-0 ${
                    action.priority === "high" ? "text-warning" : "text-muted-foreground"
                  }`}
                />
              )}
              <span className="truncate text-sm">{action.label}</span>
            </div>
            <Button variant="ghost" size="sm" asChild className="shrink-0">
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
