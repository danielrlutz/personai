"use client";

import Link from "next/link";
import { CheckCircle2, Circle, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { BriefingSnapshot, UsageMode } from "@/lib/api-client";
import { isPersonalFirst } from "@/lib/usage-mode";

interface BriefingActionItemsProps {
  snapshot: BriefingSnapshot;
  usageMode?: UsageMode;
}

type Action = { label: string; href: string; done?: boolean; priority?: "high" | "normal" };

export function BriefingActionItems({
  snapshot,
  usageMode = "PERSONAL",
}: BriefingActionItemsProps) {
  const personalFirst = isPersonalFirst(usageMode);
  const personalActions: Action[] = [];
  const businessActions: Action[] = [];
  const urgentFristen: Action[] = [];

  const seenUrgent = new Set<string>();
  (snapshot.legal.urgentWithin36h ?? []).forEach((frist) => {
    const key = `${frist.kind}:${frist.title}:${frist.dueDate}`;
    if (seenUrgent.has(key)) return;
    seenUrgent.add(key);
    const when =
      frist.hoursUntil < 0
        ? "overdue"
        : frist.hoursUntil <= 36
          ? `≤${Math.max(1, frist.hoursUntil)}h`
          : "soon";
    urgentFristen.push({
      label: `Frist ${when}: ${frist.title}`,
      href: frist.kind === "document" ? "/ingest" : "/legal",
      priority: "high",
    });
  });

  snapshot.personal?.tasksDueToday.forEach((task) => {
    personalActions.push({
      label: task.title,
      href: "/life",
      priority: "high",
    });
  });

  snapshot.personal?.habitsPending.forEach((habit) => {
    personalActions.push({
      label: `Log habit: ${habit.title}`,
      href: "/life",
    });
  });

  snapshot.personal?.touchpointsDue.forEach((tp) => {
    personalActions.push({
      label: `Reach out to ${tp.contactName}`,
      href: "/life",
    });
  });

  if (snapshot.personal && snapshot.personal.overdueTasks > 0) {
    personalActions.push({
      label:
        snapshot.personal.overdueTasks === 1
          ? "Resolve 1 overdue personal task"
          : `Resolve ${snapshot.personal.overdueTasks} overdue personal tasks`,
      href: "/life",
      priority: "high",
    });
  }

  snapshot.finance.billsDueToday.forEach((bill) => {
    businessActions.push({
      label: `Pay ${bill.creditor} (${bill.amount.toFixed(2)} CHF)`,
      href: "/finance",
      priority: "high",
    });
  });

  snapshot.legal.tasksDueToday.forEach((task) => {
    const alreadyUrgent = (snapshot.legal.urgentWithin36h ?? []).some(
      (u) => u.kind === "legal_task" && u.title === task.title,
    );
    if (alreadyUrgent) return;
    businessActions.push({
      label: task.title,
      href: "/legal",
      priority: "high",
    });
  });

  if (snapshot.ingest.queuedJobs > 0) {
    businessActions.push({
      label:
        snapshot.ingest.queuedJobs === 1
          ? "Review 1 document in the archive queue"
          : `Review ${snapshot.ingest.queuedJobs} documents in the archive queue`,
      href: "/ingest",
    });
  }

  if (snapshot.legal.overdueTasks > 0 && urgentFristen.length === 0) {
    businessActions.push({
      label:
        snapshot.legal.overdueTasks === 1
          ? "Resolve 1 overdue legal task"
          : `Resolve ${snapshot.legal.overdueTasks} overdue legal tasks`,
      href: "/legal",
      priority: "high",
    });
  }

  // ≤36h Fristen always lead — skill + Swiss deadline priority.
  const actions = personalFirst
    ? [...urgentFristen, ...personalActions, ...businessActions]
    : [...urgentFristen, ...businessActions, ...personalActions];

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
            key={`${action.href}-${action.label}-${i}`}
            className="flex items-center gap-3 border-b border-border/50 py-2.5 last:border-0"
          >
            {action.done ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />
            ) : (
              <Circle
                className={`h-4 w-4 shrink-0 ${
                  action.priority === "high" ? "text-warning" : "text-muted-foreground"
                }`}
              />
            )}
            <span className="min-w-0 flex-1 truncate text-sm">{action.label}</span>
            <Button variant="ghost" size="sm" className="shrink-0" asChild>
              <Link href={action.href}>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
