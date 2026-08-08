import cron from "node-cron";
import { getActiveProfileId, getPrisma } from "../db/prisma-singleton.js";
import { config } from "../config.js";
import { regenerateBriefing, streamBriefingNarrative } from "./briefing-service.js";

let task: cron.ScheduledTask | null = null;

export function startBriefingScheduler(): void {
  if (task) return;

  // Check every minute; generate when local time matches preferredTime
  task = cron.schedule("* * * * *", async () => {
    const profileId = getActiveProfileId();
    if (!profileId) return;

    try {
      const prisma = await getPrisma(profileId);
      const setting = await prisma.setting.findUnique({
        where: { key: "briefing.preferredTime" },
      });
      const preferred = setting?.value ?? "07:00";
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      if (`${hh}:${mm}` !== preferred) return;

      await regenerateBriefing(prisma);
      if (config.licenseTier === "pro") {
        // Drain stream to persist narrative
        for await (const _ of streamBriefingNarrative(prisma)) {
          // discard tokens — persistence happens inside generator
        }
      }
    } catch (err) {
      console.error("[briefing-scheduler]", err);
    }
  });
}

export function stopBriefingScheduler(): void {
  task?.stop();
  task = null;
}
