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
    fontSize: 11,
    fontWeight: 700,
    marginBottom: 8,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    borderBottomWidth: 1,
    borderBottomColor: "#cbd5e1",
    paddingBottom: 8,
  },
  title: {
    fontSize: 16,
    marginTop: 14,
    marginBottom: 4,
    fontWeight: 700,
  },
  meta: {
    color: "#475569",
    marginBottom: 14,
  },
  section: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 12,
    fontWeight: 700,
  },
  row: {
    borderBottomWidth: 1,
    borderBottomColor: "#e2e8f0",
    paddingVertical: 5,
    flexDirection: "row",
    gap: 8,
  },
  colCat: { width: "18%", color: "#334155" },
  colName: { width: "52%" },
  colDate: { width: "18%", color: "#475569" },
  colType: { width: "12%", color: "#64748b", fontSize: 8 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    fontSize: 8,
    color: "#64748b",
    textAlign: "center",
  },
  note: {
    marginTop: 16,
    fontSize: 9,
    color: "#475569",
  },
});

export type JahresakteIndexItem = {
  archiveName: string;
  categoryLabel: string;
  documentType: string;
  dateLabel: string;
};

export type JahresakteIndexData = {
  profileName: string;
  year: number;
  generatedAt: string;
  categories: string[];
  items: JahresakteIndexItem[];
};

export function JahresakteIndexDocument({ data }: { data: JahresakteIndexData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.header}>PersonAI · Swiss Jahresakte</Text>
        <Text style={styles.title}>Jahresakte {data.year}</Text>
        <Text style={styles.meta}>
          Profile: {data.profileName} · {data.items.length} document
          {data.items.length === 1 ? "" : "s"} · Generated {data.generatedAt}
        </Text>
        <Text style={styles.meta}>
          Categories: {data.categories.length ? data.categories.join(", ") : "—"}
        </Text>

        <Text style={styles.section}>Index</Text>
        {data.items.length === 0 ? (
          <Text>No confirmed archive documents matched this year pack.</Text>
        ) : (
          data.items.map((item, i) => (
            <View key={i} style={styles.row} wrap={false}>
              <Text style={styles.colCat}>{item.categoryLabel}</Text>
              <Text style={styles.colName}>{item.archiveName}</Text>
              <Text style={styles.colDate}>{item.dateLabel}</Text>
              <Text style={styles.colType}>{item.documentType}</Text>
            </View>
          ))
        )}

        <Text style={styles.note}>
          Pack layout: INDEX.pdf plus taxonomy folders (e.g. 04_Financial). Local export is the
          confirm barrier; Drive upload is optional and continues as a ServerJob after Confirm.
        </Text>
        <Text style={styles.footer} fixed>
          PersonAI Jahresakte {data.year} — local-first, confirm-gated
        </Text>
      </Page>
    </Document>
  );
}
