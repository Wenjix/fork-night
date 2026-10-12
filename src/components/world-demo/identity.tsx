import { DEMO_ROLES } from "@/lib/world-demo/roles";
import type { Seat } from "@/lib/world-demo/model";

export function RoleIdentity({ role, name, prefix, detail }: { role: Seat; name: string; prefix?: string; detail?: string }) {
  return <span className="wd-person" data-role={role}>
    <span className="wd-avatar" aria-hidden="true">{DEMO_ROLES[role].initial}</span>
    <span className="wd-person-copy"><span>{prefix && <>{prefix} </>}<strong>{name}</strong></span>{detail && <small>{detail}</small>}</span>
  </span>;
}
