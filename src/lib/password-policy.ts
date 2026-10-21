/** New / changed account passwords: 6–16 chars with at least one special character. */
export const PASSWORD_MIN_LEN = 6;
export const PASSWORD_MAX_LEN = 16;

const SPECIAL_RE = /[^A-Za-z0-9]/;

export type PasswordChecks = {
  lengthOk: boolean;
  hasSpecial: boolean;
};

export function passwordChecks(password: string): PasswordChecks {
  const len = password.length;
  return {
    lengthOk: len >= PASSWORD_MIN_LEN && len <= PASSWORD_MAX_LEN,
    hasSpecial: SPECIAL_RE.test(password),
  };
}

export function isPasswordValid(password: string): boolean {
  const c = passwordChecks(password);
  return c.lengthOk && c.hasSpecial;
}

/** Human-readable error, or null when valid. */
export function passwordPolicyError(password: string): string | null {
  if (password.length < PASSWORD_MIN_LEN) {
    return `Password must be at least ${PASSWORD_MIN_LEN} characters`;
  }
  if (password.length > PASSWORD_MAX_LEN) {
    return `Password must be at most ${PASSWORD_MAX_LEN} characters`;
  }
  if (!SPECIAL_RE.test(password)) {
    return "Password must include at least one special character";
  }
  return null;
}

export const PASSWORD_POLICY_HINT = `${PASSWORD_MIN_LEN}–${PASSWORD_MAX_LEN} characters, with at least one special character`;
