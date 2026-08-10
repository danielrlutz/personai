/** Minimal iCalendar (RFC 5545) helpers for Fristen calendar packs. */

export type IcsEvent = {
  uid: string;
  title: string;
  description?: string | null;
  /** ISO date/time or Date — all-day when time is midnight local / date-only. */
  start: Date | string;
  end?: Date | string | null;
  allDay?: boolean;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Escape TEXT values per RFC 5545. */
export function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** UTC timestamp: 20260810T140000Z */
export function formatIcsUtc(d: Date): string {
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

/** Floating/local DATE: 20260810 */
export function formatIcsDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function isMidnightLocal(d: Date): boolean {
  return d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0 && d.getMilliseconds() === 0;
}

function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  parts.push(line.slice(0, 75));
  let rest = line.slice(75);
  while (rest.length > 0) {
    parts.push(` ${rest.slice(0, 74)}`);
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

function eventBlock(event: IcsEvent, now: Date): string {
  const start = toDate(event.start);
  const allDay = event.allDay ?? isMidnightLocal(start);
  const lines = [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${formatIcsUtc(now)}`,
  ];
  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(start)}`);
    const end = event.end
      ? toDate(event.end)
      : new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    lines.push(`DTEND;VALUE=DATE:${formatIcsDate(end)}`);
  } else {
    lines.push(`DTSTART:${formatIcsUtc(start)}`);
    if (event.end) {
      lines.push(`DTEND:${formatIcsUtc(toDate(event.end))}`);
    }
  }
  lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  lines.push("END:VEVENT");
  return lines.map(foldLine).join("\r\n");
}

export function buildIcsCalendar(
  events: IcsEvent[],
  options?: { productId?: string; name?: string },
): string {
  const now = new Date();
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${escapeIcsText(options?.productId ?? "-//PersonAI//Fristen//EN")}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(options?.name ?? "PersonAI Fristen")}`,
  ];
  const body = events.map((e) => eventBlock(e, now));
  return [...header, ...body, "END:VCALENDAR", ""].join("\r\n");
}
