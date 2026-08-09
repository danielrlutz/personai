export type SpecialistId =
  | "secretary"
  | "architect"
  | "forge"
  | "qa_auditor"
  | "cfo"
  | "legal_aide"
  | "medical_integrator"
  | "bio_mechanic"
  | "mystic"
  | "stylist"
  | "wingman"
  | "career_strategist";

export interface SpecialistMeta {
  id: SpecialistId;
  label: string;
  shortLabel: string;
  description: string;
  group: "ops" | "code" | "care" | "coaching";
}

/** Fallback roster if /specialists is unreachable — keep in sync with server. */
export const SPECIALIST_FALLBACK: SpecialistMeta[] = [
  { id: "secretary", label: "Staff", shortLabel: "Staff", description: "Triage, archive, morning brief", group: "ops" },
  { id: "architect", label: "Architect", shortLabel: "Architect", description: "Design and specs", group: "code" },
  { id: "forge", label: "Forge", shortLabel: "Forge", description: "Implementation", group: "code" },
  { id: "qa_auditor", label: "QA Auditor", shortLabel: "QA", description: "Pass/fail before ship", group: "code" },
  { id: "cfo", label: "CFO", shortLabel: "CFO", description: "Invoices and ledger", group: "ops" },
  { id: "legal_aide", label: "Legal Aide", shortLabel: "Legal", description: "Deadlines (Fristen) and filings", group: "ops" },
  { id: "medical_integrator", label: "Medical Integrator", shortLabel: "Medical", description: "Records (not diagnosis)", group: "care" },
  { id: "bio_mechanic", label: "Bio Mechanic", shortLabel: "Bio", description: "Body and recovery", group: "care" },
  { id: "mystic", label: "Mystic", shortLabel: "Mystic", description: "Reflective coaching", group: "coaching" },
  { id: "stylist", label: "Stylist", shortLabel: "Stylist", description: "Aesthetic coaching", group: "coaching" },
  { id: "wingman", label: "Wingman", shortLabel: "Wingman", description: "Social coaching", group: "coaching" },
  { id: "career_strategist", label: "Career Strategist", shortLabel: "Career", description: "CV and career PDF", group: "ops" },
];

export const GROUP_LABEL: Record<SpecialistMeta["group"], string> = {
  ops: "Ops",
  code: "Code",
  care: "Care",
  coaching: "Coaching",
};
