/**
 * Profile display name limits — kept in sync with apps/web/lib/profile-name-limits.ts
 * (header ProfileSwitcher slot widths use the mobile/sm visible counts).
 */
export const PROFILE_NAME_VIEWPORT_VISIBLE = {
  /** Phone header — search icon-only; profile pill ~min(42vw, Nch + chrome). */
  mobile: 12,
  /** sm+ header — wider profile slot (AppShell sm breakpoint). */
  sm: 18,
  /** Profile list, settings, sidebar — full row width. */
  wide: 32,
} as const;

export const PROFILE_NAME_MIN_LENGTH = 1;
export const PROFILE_NAME_HARD_CAP = PROFILE_NAME_VIEWPORT_VISIBLE.wide;

export type ProfileNameLimits = {
  maxLength: number;
  minLength: number;
  visibleChars: {
    mobile: number;
    sm: number;
    wide: number;
  };
};

function envInt(name: string): number | undefined {
  const raw = process.env[name]?.trim();
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Resolved signup/display cap — defaults to mobile visible budget. */
export function resolveProfileNameMaxLength(): number {
  const configured = envInt("PROFILE_NAME_MAX_LENGTH");
  const fallback = PROFILE_NAME_VIEWPORT_VISIBLE.mobile;
  const max = configured ?? fallback;
  return Math.min(Math.max(max, PROFILE_NAME_MIN_LENGTH), PROFILE_NAME_HARD_CAP);
}

export function getProfileNameLimits(): ProfileNameLimits {
  return {
    maxLength: resolveProfileNameMaxLength(),
    minLength: PROFILE_NAME_MIN_LENGTH,
    visibleChars: PROFILE_NAME_VIEWPORT_VISIBLE,
  };
}

export function validateProfileName(name: string): { ok: true; trimmed: string } | { ok: false; error: string } {
  const trimmed = name.trim();
  const { maxLength, minLength } = getProfileNameLimits();

  if (trimmed.length < minLength) {
    return { ok: false, error: "Profile name is required" };
  }
  if (trimmed.length > maxLength) {
    return {
      ok: false,
      error: `Profile name must be at most ${maxLength} characters (fits the header on phone and desktop)`,
    };
  }
  if (/[\r\n\t]/.test(name)) {
    return { ok: false, error: "Profile name cannot contain line breaks" };
  }
  return { ok: true, trimmed };
}

export function assertProfileName(name: string): string {
  const result = validateProfileName(name);
  if (!result.ok) throw new Error(result.error);
  return result.trimmed;
}

/** Truncate to max length (imports / recovery stubs) without throwing. */
export function clampProfileName(name: string): string {
  const max = resolveProfileNameMaxLength();
  return name.trim().slice(0, max);
}
