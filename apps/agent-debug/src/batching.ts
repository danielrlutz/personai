export type WaitSignal = {
  awaitingMore: boolean;
  reason: string | null;
  flushNow: boolean;
};

const WAIT_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\bwait\s+for\b/i,
    reason: "user asked to wait",
  },
  {
    re: /\b(coming|arriving)\s+(next|soon|in\s+a\s+(sec|second|moment))\b/i,
    reason: "more content coming next",
  },
  {
    re: /\b(second|2nd|next|another)\s+(message|msg|image|picture|photo|pic)\b/i,
    reason: "expecting a follow-up message/image",
  },
  {
    re: /\b(hold|don't\s+send|do\s+not\s+send|not\s+yet)\b/i,
    reason: "user asked to hold",
  },
  {
    re: /\b(pictures?|images?|photos?|pics?)\s+(in\s+)?(my\s+)?(second|next|following)\b/i,
    reason: "waiting for pictures in a follow-up",
  },
  {
    re: /\bmore\s+(coming|to\s+follow|messages?|images?)\b/i,
    reason: "more messages coming",
  },
];

const FLUSH_PATTERNS = [
  /\bsend\s+now\b/i,
  /\bflush\s+now\b/i,
  /\bgo\s+ahead\b/i,
  /\bthat's\s+all\b/i,
  /\bthats\s+all\b/i,
  /\bready\s+to\s+send\b/i,
  /\bcompose\s+now\b/i,
  /\bdone\s*[!.]?\s*$/i,
];

export function detectWaitSignal(text: string): WaitSignal {
  const trimmed = text.trim();
  if (!trimmed) {
    return { awaitingMore: false, reason: null, flushNow: false };
  }

  const flushNow = FLUSH_PATTERNS.some((re) => re.test(trimmed));
  if (flushNow) {
    return { awaitingMore: false, reason: null, flushNow: true };
  }

  for (const { re, reason } of WAIT_PATTERNS) {
    if (re.test(trimmed)) {
      return { awaitingMore: true, reason, flushNow: false };
    }
  }

  return { awaitingMore: false, reason: null, flushNow: false };
}

/** True when message looks like an image-only follow-up that should join an awaiting batch. */
export function looksLikeFollowUp(text: string, imageCount: number): boolean {
  if (imageCount > 0 && !text.trim()) return true;
  if (imageCount > 0 && /^(here|this|these|attached|see\s+above)\b/i.test(text.trim())) {
    return true;
  }
  return false;
}
