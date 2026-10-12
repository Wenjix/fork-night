import { panelImage, type Panel } from "@/lib/world-demo/model";

export function WorkPanels({ panels, compact = false }: { panels: Panel[]; compact?: boolean }) {
  return <div className={`wd-panels ${panels.length === 1 ? "wd-single-panel" : ""} ${compact ? "wd-compact-panels" : ""}`} data-panel-count={panels.length}>
    {panels.map((panel, index) => {
      const art = panelImage(panel);
      return <figure key={index}><img src={art.src} alt={art.alt} width={1200} height={panel.asset === "hero" ? 400 : panel.asset === "outcome" ? 800 : 1200} loading={index > 0 ? "lazy" : "eager"} /><figcaption>{panels.length > 1 && <span className="wd-panel-number">Panel {index + 1}</span>}{panel.caption}</figcaption></figure>;
    })}
  </div>;
}
