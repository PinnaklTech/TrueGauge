/** Survives route changes so login → workspace doesn't flash a tiny centered spinner. */

type BootState = {
  active: boolean;
  message: string;
};

type Listener = () => void;

let state: BootState = { active: false, message: "" };
let welcomeToast: string | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

export function getWorkspaceBootState(): BootState {
  return state;
}

export function subscribeWorkspaceBoot(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startWorkspaceBoot(message = "Loading your workspace…") {
  state = { active: true, message };
  emit();
}

export function setWorkspaceBootMessage(message: string) {
  if (!state.active) return;
  state = { ...state, message };
  emit();
}

export function queueWelcomeToast(message: string) {
  welcomeToast = message;
}

export function takeWelcomeToast(): string | null {
  const msg = welcomeToast;
  welcomeToast = null;
  return msg;
}

export function endWorkspaceBoot() {
  if (!state.active) return;
  state = { active: false, message: "" };
  emit();
}

export function isWorkspaceBootActive() {
  return state.active;
}
