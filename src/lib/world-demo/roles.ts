import { invitationLink, worldLink, type Seat, type WorldState } from "./model.ts";

export const DEMO_ROLES = {
  maker: { name: "Mira", initial: "M", part: "Starts the scene", action: "Introduce the detail someone else can carry forward." },
  continuing: { name: "Kai", initial: "K", part: "Continues Mira’s scene", action: "Add your next moment. Mira’s original keeps her credit." },
  curator: { name: "Demo curator", initial: "C", part: "Selects the chapter", action: "Bring the contributions together, with each maker’s credit." },
} as const;

/** A presenter can open a role; its own authenticated guest still has to enter. */
export function roleDestination(host: WorldState, runId: string, seat: Seat): string {
  if (host.id !== runId || host.me.role !== "curator") throw new Error("This browser could not confirm the room host. Reopen the host’s original view.");
  if (seat === "curator") return worldLink(runId, seat);
  const invitation = host.invitations.find(item => item.role === seat);
  if (invitation?.claimed) return worldLink(runId, seat, "my-work");
  if (invitation?.token && /^[a-f0-9]{64}$/.test(invitation.token)) return invitationLink(runId, seat, invitation.token);
  throw new Error(`${DEMO_ROLES[seat].name}’s invitation is not ready. Refresh the host view and try again.`);
}

/** A solo presenter joins through the target seat's own client; the host never impersonates it. */
export async function enterPresenterRole(host: WorldState, seat: Seat, ports: {
  read: (seat: Seat, runId: string) => Promise<WorldState>;
  join: (seat: Seat, runId: string, token: string) => Promise<WorldState>;
}): Promise<WorldState> {
  if (host.me.role !== "curator") throw new Error("Reopen the room host before switching demo roles.");
  if (seat === "curator") return host;
  const invitation = host.invitations.find(item => item.role === seat);
  const next = invitation?.claimed ? await ports.read(seat, host.id)
    : invitation?.token && /^[a-f0-9]{64}$/.test(invitation.token) ? await ports.join(seat, host.id, invitation.token)
      : null;
  if (!next || next.id !== host.id || next.me.role !== seat) throw new Error(`${DEMO_ROLES[seat].name}’s seat could not be opened here. Use the browser where it was claimed.`);
  return next;
}
