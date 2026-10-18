import { Check, GitBranch, GitCommitHorizontal, ArrowUpRight } from "lucide-react";
import type { PilotMoment } from "../lib/pilot";
import type { PreparedRelease } from "../lib/onchain/model";
import type { Snapshot } from "../lib/onchain/client";
import type { ReleaseConfig } from "../lib/onchain/config";
import { shortAddress } from "../lib/onchain/journey";
import { BrandBadge } from "./brand-badge";

export function KesslerContributions({ prepared, moments, snapshot, loading, error, config, assisted, onInspect, onChoosePath }: {
  prepared: PreparedRelease; moments: PilotMoment[]; snapshot?: Snapshot; loading: boolean; error: string; config: ReleaseConfig;
  assisted?: ReadonlySet<string>; onInspect?: (id: string) => void; onChoosePath: (id: string) => void;
}) {
  const parents = new Set(moments.map(moment => moment.parent_id));
  const ends = moments.filter(moment => !parents.has(moment.id));
  const registered = snapshot?.scenes.filter(scene => scene.registered && scene.matches).length;
  return <section id="kessler-contributions" className="kessler-contributions" tabIndex={-1} aria-labelledby="kessler-contributions-title">
    <div className="kessler-contributions-heading"><div><h2 id="kessler-contributions-title">The contribution trail</h2><p>Every scene keeps its parent and storyteller. Choose a branch to follow its full history.</p></div><BrandBadge brand="monad" /></div>
    <label className="kessler-path-choice"><GitBranch size={16} aria-hidden="true" /><span>Trace a path</span><select value={prepared.scenes.at(-1)!.moment.id} onChange={event => onChoosePath(event.target.value)}>
      {!ends.some(moment => moment.id === prepared.scenes.at(-1)!.moment.id) && <option value={prepared.scenes.at(-1)!.moment.id}>Through {prepared.scenes.at(-1)!.moment.title}</option>}
      {ends.map(moment => <option key={moment.id} value={moment.id}>{moment.title} · {moment.maker_id ? moment.maker_label : "prepared branch"}</option>)}
    </select></label>
    <ol className="kessler-commit-list" aria-label="Contributions in this path">{prepared.scenes.map((scene, index) => {
      const record = snapshot?.scenes[index];
      const verified = record?.registered && record.matches;
      const forks = moments.filter(moment => moment.parent_id === scene.moment.id).length;
      return <li key={scene.id} data-registered={!!verified}>
        <GitCommitHorizontal size={20} className="kessler-commit-node" aria-hidden="true" />
        <div className="kessler-commit-copy"><button type="button" onClick={() => onInspect?.(scene.moment.id)}>{scene.moment.title}</button>
          <span>{scene.moment.maker_id ? scene.moment.maker_label : "Prepared story"}{assisted?.has(scene.moment.id) ? " · Wren assisted" : ""} · {index === 0 ? "Opening" : `Continues scene ${index}`}{forks > 1 ? ` · ${forks} forks` : ""}</span>
        </div>
        <div className="kessler-commit-proof">{verified ? <>
          <span><Check size={14} aria-hidden="true" />Registered on Monad</span>
          {config.explorer && <a href={record.transactionHash ? `${config.explorer}/tx/${record.transactionHash}` : `${config.explorer}/address/${config.address}#readContract`} target="_blank" rel="noreferrer">{record.transactionHash ? "Registration receipt" : "Contract record"}<ArrowUpRight size={14} aria-hidden="true" /></a>}
          <small title={record.maker}>{shortAddress(record.maker)}</small>
        </> : <span>{record ? "Not registered on Monad" : loading ? "Checking Monad…" : "Monad status unavailable"}</span>}</div>
      </li>;
    })}</ol>
    <div className="kessler-contributions-foot"><p>{snapshot ? `${registered} of ${prepared.scenes.length} scenes registered · read at block ${snapshot.block.toLocaleString("en-US")}.` : "Publishing a scene saves its byline in the room."} Registration on Monad is a separate wallet signature.</p>{error && <p role="status">{snapshot ? "Showing the last verified block. Open release controls to check the latest status." : "Monad could not be reached. The published story is still available."}</p>}</div>
  </section>;
}
