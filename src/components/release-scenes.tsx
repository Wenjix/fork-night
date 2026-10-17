import { Check, Clock3 } from "lucide-react";
import { ZeroAddress } from "ethers";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/supabase/database.types.ts";
import type { Snapshot, Operation } from "../lib/onchain/client.ts";
import { registrationReason, shortAddress } from "../lib/onchain/journey.ts";
import { releaseByline, releaseRoom, sameAddress, type PreparedRelease } from "../lib/onchain/model.ts";
import { pilotPanels } from "../lib/pilot.ts";
import { PilotImage } from "./pilot-panels.tsx";

export function ReleaseScenes({ prepared, snapshot, account, accepted, busy, pending, onAction, onInspect, client, explorer }: {
  prepared: PreparedRelease; snapshot: Snapshot; account: string;
  accepted: boolean; busy: boolean; pending: boolean;
  onAction: (operation: Operation, index: number, address?: string) => void;
  onInspect?: (id: string) => void; client?: SupabaseClient<Database>; explorer?: string;
}) {
  return <ol className="pilot-release-path">{prepared.scenes.map((scene, index) => {
    const record = snapshot.scenes[index], approved = record.maker !== ZeroAddress;
    const preparedWork = scene.moment.maker_id === null && !!releaseRoom(scene.moment.room_id)?.preparedLabel;
    const own = approved && !!account && sameAddress(record.maker, account);
    const reason = registrationReason({ prepared, snapshot, index, account, accepted, busy, pending });
    const helpId = `${scene.id}-registration-help`;
    return <li key={scene.id} data-registered={record.matches}>
      {client && <button className="pilot-release-scene-art" type="button" aria-label={`Read scene ${index + 1}: ${scene.moment.title}`} onClick={() => onInspect?.(scene.moment.id)}>
        <PilotImage client={client} panel={pilotPanels(scene.moment.panels)[0]} allowRetry={false} />
      </button>}
      <div className="pilot-release-scene-copy">
        <strong>{scene.moment.title}</strong>
        <span>{releaseByline(scene.moment)}{scene.moment.parent_id === null ? " · original opening" : ""}</span>
        {preparedWork && <span>Sample byline: {scene.moment.maker_label}</span>}
        <SceneRegistrationState record={record} approved={approved} explorer={explorer} />
      </div>
      <div className="pilot-release-scene-action">
        {own && !record.registered && <>
          <button className="button secondary" type="button" disabled={!!reason} aria-describedby={reason ? helpId : undefined} onClick={() => onAction("register", index)}>Register scene</button>
          {reason && <span id={helpId} role="status">{reason}</span>}
        </>}
        {!approved && <span>{preparedWork ? "The curator confirms the prepared story's actual rights holder and approves that wallet." : "The maker sends a signed wallet request for curator review."}</span>}
        {approved && !record.registered && account && !own && <span>Waiting for the approved wallet to register.</span>}
      </div>
    </li>;
  })}</ol>;
}

function SceneRegistrationState({ record, approved, explorer }: {
  record: Snapshot["scenes"][number]; approved: boolean; explorer?: string;
}) {
  const contents = <>
    {record.registered ? <Check size={15} aria-hidden="true" /> : <Clock3 size={15} aria-hidden="true" />}
    {record.registered ? "Scene registered" : approved ? "Wallet approved · scene not registered" : "Awaiting wallet approval"}
    {approved && <span title={record.maker}>{shortAddress(record.maker)}</span>}
  </>;
  const tx = record.registered && record.transactionHash && explorer ? `${explorer}/tx/${record.transactionHash}` : "";
  return tx
    ? <a className="pilot-release-scene-state" href={tx} target="_blank" rel="noreferrer">{contents}</a>
    : <span className="pilot-release-scene-state">{contents}</span>;
}
