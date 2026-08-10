export const CHAT_MARKDOWN_PREF_KEY = "personai.team.chatMarkdown";

export type ChatMarkdownMode = "formatted" | "raw";

export function readChatMarkdownPref(): ChatMarkdownMode {
  if (typeof window === "undefined") return "formatted";
  try {
    const raw = localStorage.getItem(CHAT_MARKDOWN_PREF_KEY);
    if (raw === "raw" || raw === "formatted") return raw;
  } catch {
    /* ignore */
  }
  return "formatted";
}

export function writeChatMarkdownPref(mode: ChatMarkdownMode): void {
  try {
    localStorage.setItem(CHAT_MARKDOWN_PREF_KEY, mode);
  } catch {
    /* ignore */
  }
}
