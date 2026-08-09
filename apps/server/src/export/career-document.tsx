// @ts-nocheck
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Document, Page, Text, StyleSheet, View } from "@react-pdf/renderer";
const styles = StyleSheet.create({
    page: { padding: 40, fontSize: 11, fontFamily: "Helvetica", color: "#1a1a1a" },
    title: { fontSize: 18, marginBottom: 6, fontFamily: "Helvetica-Bold" },
    subtitle: { fontSize: 10, color: "#555", marginBottom: 18 },
    sectionTitle: { fontSize: 12, marginTop: 14, marginBottom: 6, fontFamily: "Helvetica-Bold" },
    body: { lineHeight: 1.45 },
    footer: { position: "absolute", bottom: 28, left: 40, right: 40, fontSize: 8, color: "#888" },
});
export function CareerDocument({ data }) {
    return (_jsx(Document, { children: _jsxs(Page, { size: "A4", style: styles.page, children: [_jsx(Text, { style: styles.title, children: data.title }), data.subtitle ? _jsx(Text, { style: styles.subtitle, children: data.subtitle }) : null, data.sections.map((section) => (_jsxs(View, { wrap: false, children: [_jsx(Text, { style: styles.sectionTitle, children: section.heading }), _jsx(Text, { style: styles.body, children: section.body })] }, section.heading))), _jsxs(Text, { style: styles.footer, children: ["PersonAI Career \u00B7 ", data.generatedAt, " \u00B7 local export"] })] }) }));
}
//# sourceMappingURL=career-document.js.map