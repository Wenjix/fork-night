"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { DEMO_ROLES } from "@/lib/world-demo/roles";
import type { Seat } from "@/lib/world-demo/model";
import type { DemoController } from "./world-demo";
import { RoleIdentity } from "./identity";

const accountRoles = { maker: "Scene maker", continuing: "Continuing maker", curator: "Room curator" };

export function AccountSwitcher({ demo }: { demo: DemoController }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const member = demo.state!.me;
  const name = (role: Seat) => role === "curator" ? "Room curator" : demo.state!.members.find(item => item.role === role)?.label ?? DEMO_ROLES[role].name;
  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) { if (!container.current?.contains(event.target as Node)) setOpen(false); }
    function escape(event: KeyboardEvent) { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  async function change(role: Seat) {
    setOpen(false);
    await demo.switchRole(role, "my-work");
    trigger.current?.focus();
  }
  return <div className="wd-account-switcher" ref={container} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={trigger} className="wd-account-trigger" type="button" aria-expanded={open} aria-controls={menuId} aria-label={`Account: ${name(member.role)}. Switch account`} onClick={() => setOpen(!open)}>
      <RoleIdentity role={member.role} name={member.role === "curator" ? "Curator" : name(member.role)} /><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div id={menuId} className="wd-account-menu" aria-label="Switch account">
      <p>Room accounts</p><ul>{(demo.hostedHere ? ["maker", "continuing", "curator"] : [member.role]).map(value => {
        const role = value as Seat;
        const current = role === member.role;
        const joined = role === "curator" || demo.state!.members.some(item => item.role === role);
        return <li key={role}><button type="button" aria-current={current ? "true" : undefined} disabled={demo.busy || !!demo.pending || current} onClick={() => void change(role)}>
          <RoleIdentity role={role} name={name(role)} detail={accountRoles[role]} />
          {current ? <Check size={16} aria-label="Current account" /> : <small>{joined ? "Switch" : "Join"}</small>}
        </button></li>;
      })}</ul><small>{demo.hostedHere ? "Each account keeps its own private drafts." : "This guest account is available in this browser. Open other accounts where they joined."}</small>
    </div>}
  </div>;
}
