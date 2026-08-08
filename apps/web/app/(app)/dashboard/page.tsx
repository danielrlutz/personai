"use client";

import { motion } from "framer-motion";
import { DailyBriefing } from "@/components/briefing/DailyBriefing";
import { BudgetOverview } from "@/components/finance/BudgetOverview";
import { QRBillList } from "@/components/finance/QRBillList";
import { LegalTimeline } from "@/components/legal/LegalTimeline";
import { IngestionQueue } from "@/components/ingest/IngestionQueue";

const fade = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
};

export default function DashboardPage() {
  return (
    <div className="space-y-8">
      <DailyBriefing />

      <motion.div
        {...fade}
        transition={{ delay: 0.05 }}
        className="grid gap-6 lg:grid-cols-2"
      >
        <BudgetOverview />
        <QRBillList />
      </motion.div>

      <motion.div {...fade} transition={{ delay: 0.1 }} className="grid gap-6 lg:grid-cols-2">
        <LegalTimeline />
        <IngestionQueue />
      </motion.div>
    </div>
  );
}
