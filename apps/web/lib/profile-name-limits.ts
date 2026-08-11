/**
 * Profile display name limits — keep in sync with apps/server/src/profiles/name-limits.ts
 */
export const PROFILE_NAME_VIEWPORT_VISIBLE = {
  mobile: 12,
  sm: 18,
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

export const DEFAULT_PROFILE_NAME_LIMITS: ProfileNameLimits = {
  maxLength: PROFILE_NAME_VIEWPORT_VISIBLE.mobile,
  minLength: PROFILE_NAME_MIN_LENGTH,
  visibleChars: PROFILE_NAME_VIEWPORT_VISIBLE,
};

/** CSS width for header profile pill: text (N ch) + avatar, chevron, padding. */
export function profileNameSlotWidthStyle(maxLength: number): string {
  return `min(42vw, calc(${maxLength}ch + 3.25rem))`;
}

export function validateProfileNameClient(
  name: string,
  limits: ProfileNameLimits = DEFAULT_PROFILE_NAME_LIMITS,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length < limits.minLength) return "Profile name is required";
  if (trimmed.length > limits.maxLength) {
    return `Profile name must be at most ${limits.maxLength} characters`;
  }
  if (/[\r\n\t]/.test(name)) return "Profile name cannot contain line breaks";
  return null;
}
