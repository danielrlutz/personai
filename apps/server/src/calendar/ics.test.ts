import assert from "node:assert/strict";
import { buildIcsCalendar, escapeIcsText, formatIcsDate, formatIcsUtc } from "./ics.js";

assert.equal(escapeIcsText("Hello, world; yes\\no\nnext"), "Hello\\, world\\; yes\\\\no\\nnext");

const utc = formatIcsUtc(new Date(Date.UTC(2026, 7, 10, 14, 30, 0)));
assert.equal(utc, "20260810T143000Z");

const local = formatIcsDate(new Date(2026, 7, 10));
assert.equal(local, "20260810");

const ics = buildIcsCalendar([
  {
    uid: "test-1@personai.local",
    title: "MWST Q2; filing",
    description: "Line 1\nLine 2",
    start: new Date(2026, 7, 15),
    allDay: true,
  },
]);

assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
assert.match(ics, /SUMMARY:MWST Q2\\; filing/);
assert.match(ics, /DESCRIPTION:Line 1\\nLine 2/);
assert.match(ics, /DTSTART;VALUE=DATE:20260815/);
assert.match(ics, /END:VCALENDAR/);

console.log("ics.test.ts: ok");
