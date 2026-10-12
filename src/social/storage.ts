import type { DemoState } from "../domain/types.ts";
import { validateSocialState, type SocialState } from "./model.ts";

export const SOCIAL_STORAGE_KEY = "fork-night-social-v1";

/** A social edit is accepted only after storage succeeds, before its UI unmounts. */
export function commitSocialChange(
  storage: { setItem(key: string, value: string): void },
  current: SocialState,
  demo: DemoState,
  action: (current: SocialState) => SocialState,
): SocialState {
  const next = action(current);
  validateSocialState(next, demo);
  try {
    storage.setItem(SOCIAL_STORAGE_KEY, JSON.stringify(next));
  } catch {
    throw new Error(
      "This browser could not save the change, so it has not been applied. Copy any unposted text before leaving; free some browser storage and try again.",
    );
  }
  return next;
}
