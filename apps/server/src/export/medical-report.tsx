import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 40,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#0f172a",
  },
  header: {
    fontSize: 12,
    fontWeight: 700,
    marginBottom: 8,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: "#0f172a",
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 8,
  },
  title: {
    fontSize: 16,
    marginTop: 16,
    marginBottom: 4,
    fontWeight: 700,
  },
  meta: {
    color: "#475569",
    marginBottom: 16,
  },
  section: {
    marginTop: 14,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 700,
  },
  card: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 4,
    padding: 10,
    marginBottom: 8,
  },
  label: {
    fontWeight: 700,
    marginBottom: 2,
  },
  disclaimer: {
    marginTop: 24,
    padding: 10,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#cbd5e1",
    fontSize: 9,
    color: "#334155",
  },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#64748b",
    textAlign: "center",
  },
});

export type MedicalReportData = {
  profileName: string;
  title: string;
  dateFrom: string;
  dateTo: string;
  complaints: Array<{
    title: string;
    category: string;
    severity: string;
    description: string;
    occurredAt: string;
    moodScore?: number | null;
    sleepHours?: number | null;
  }>;
  analyses: Array<{
    framework: string;
    result: string;
    disclaimer: string;
  }>;
};

export function MedicalReportDocument({ data }: { data: MedicalReportData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.header}>
          Automatisierte Empfehlung basierend auf medizinischen Daten
        </Text>
        <Text style={styles.title}>{data.title}</Text>
        <Text style={styles.meta}>
          Patient: {data.profileName} · Zeitraum: {data.dateFrom} – {data.dateTo}
        </Text>

        <Text style={styles.section}>Beschwerden / Symptome</Text>
        {data.complaints.map((c, i) => (
          <View key={i} style={styles.card} wrap={false}>
            <Text style={styles.label}>
              {c.title} ({c.category} / {c.severity})
            </Text>
            <Text>{c.occurredAt}</Text>
            <Text>{c.description}</Text>
            {c.moodScore != null ? <Text>Stimmung: {c.moodScore}/10</Text> : null}
            {c.sleepHours != null ? <Text>Schlaf: {c.sleepHours}h</Text> : null}
          </View>
        ))}

        <Text style={styles.section}>Analysen</Text>
        {data.analyses.map((a, i) => (
          <View key={i} style={styles.card} wrap={false}>
            <Text style={styles.label}>Framework: {a.framework}</Text>
            <Text>{a.result}</Text>
          </View>
        ))}

        <View style={styles.disclaimer}>
          <Text>
            Keine medizinische Diagnose. Dieses Dokument enthält automatisierte Empfehlungen
            basierend auf vom Nutzer erfassten Daten. Konsultieren Sie einen Arzt oder Psychiater.
          </Text>
        </View>

        <Text
          style={styles.footer}
          render={({ pageNumber, totalPages }) =>
            `Automatisierte Empfehlung basierend auf medizinischen Daten · Seite ${pageNumber}/${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}
