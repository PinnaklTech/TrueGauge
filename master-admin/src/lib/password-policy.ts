/**
 * New / changed account passwords: 6–16 chars with at least one special character.
 * Sign-in is unaffected — existing production passwords keep working until reset.
 */
export const PASSWORD_MIN_LEN = 6;
export const PASSWORD_MAX_LEN = 16;

const SPECIAL_RE = /[^A-Za-z0-9]/;

export function passwordPolicyError(password: string, label = "Password"): string | null {
  if (password.length < PASSWORD_MIN_LEN) {
    return `${label} must be at least ${PASSWORD_MIN_LEN} characters`;
  }
  if (password.length > PASSWORD_MAX_LEN) {
    return `${label} must be at most ${PASSWORD_MAX_LEN} characters`;
  }
  if (!SPECIAL_RE.test(password)) {
    return `${label} must include at least one special character`;
  }
  return null;
}

export const PASSWORD_POLICY_HINT = `${PASSWORD_MIN_LEN}–${PASSWORD_MAX_LEN} characters, with at least one special character`;
