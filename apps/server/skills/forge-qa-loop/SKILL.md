---
name: forge-qa-loop
description: Forge implements, QA reviews, max 3 retries; ship needs confirm.
specialists: [forge, qa_auditor, architect, secretary]
---

# Forge ↔ QA loop

Use the in-app Forge↔QA orchestration (not a Telegram handoff).

1. Forge produces a full implementation (or revises from prior QA issues).
2. QA Auditor returns strict pass/fail JSON in the automated loop.
3. On fail: feed issues back to Forge. Max **3** attempts, then escalate with a deadlock summary.
4. On pass: present sanitised result; **ship/PR requires explicit confirmation** in the app (`forge.ship`).
5. Never invent compiler or test results — only use QA output.
