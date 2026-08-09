---
name: quota-gate
description: Local Ollama default; premium/cloud spend needs confirm + quota.
specialists: [secretary, forge, qa_auditor, architect, stylist, cfo]
---

# Premium quota gate

1. Local Ollama is the default. Never silently fall back to paid/cloud providers.
2. Before premium/cloud inference: explain why local is insufficient and wait for app confirmation (`premium.inference`).
3. If monthly premium quota is exhausted, refuse and show remaining limits — do not invent a workaround.
4. After approved spend, usage is recorded server-side.
