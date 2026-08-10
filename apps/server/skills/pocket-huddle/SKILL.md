---
name: pocket-huddle
description: Staff chairs a short huddle with up to 2 specialists; writes need confirm.
specialists: [secretary, cfo, legal_aide, medical_integrator, architect, forge, career_strategist, bio_mechanic, mystic, stylist, wingman, qa_auditor]
---

# Pocket huddle

Use the in-app Pocket huddle orchestration (Staff + up to two specialists in one Team thread).

1. **Staff** opens: restate the ask, name who speaks next, and what each should cover.
2. Each invited specialist gives **one focused take** — concrete next steps, not a monologue.
3. Build on prior takes; do not repeat the same summary three times.
4. **Never** claim archive, ledger, calendar, memory, PDF, or forge ship already ran.
5. If a write should happen, append a fenced `propose` JSON block (one object):

```propose
{"action":"memory.fact|calendar.event|forge.ship|huddle.propose","summary":"≤160 chars","payload":{}}
```

6. Prefer real actions when payload is complete (`memory.fact` needs `key`+`value`; `calendar.event` needs title/time fields the app already uses). Otherwise use `huddle.propose` so it lands in **Needs your confirmation**.
7. Never invent Fristen, amounts, diagnoses, or citations.
