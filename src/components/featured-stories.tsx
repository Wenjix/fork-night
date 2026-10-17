import { ArrowRight, GitBranch } from "lucide-react";
import { featuredRooms } from "@/lib/featured-stories";
import { BrandBadge, BrandStrip, Chip } from "./brand-badge";
import { StoryArt } from "./story-art";

export function FeaturedStories() {
  return (
    <section className="fn-featured-stories" aria-labelledby="fn-featured-title">
      <div className="fn-featured-heading">
        <h2 id="fn-featured-title">Choose what to explore</h2>
        <p>Each room shows a different part of Fork Night. Follow the receipts, or try the shared story.</p>
      </div>
      <ul className="fn-featured-rooms" aria-label="Rooms by focus">
        {featuredRooms.map(room => <li className="fn-featured-room" key={room.id}>
          <div className="fn-featured-art" aria-hidden="true">
            <StoryArt src={room.artwork} description={room.artworkDescription} />
          </div>
          <div className="fn-featured-copy">
            <h3>{room.title}</h3>
            <BrandStrip label={room.focus} className="fn-featured-stack">
              {room.stack.length
                ? room.stack.map(item => <BrandBadge key={item.brand} brand={item.brand} role={"role" in item ? item.role : undefined} />)
                : <Chip icon={GitBranch}>{room.focus}</Chip>}
            </BrandStrip>
            <p className="fn-featured-description">{room.description}</p>
            <p className="fn-featured-status">{room.status}</p>
          </div>
          <div className="fn-featured-actions">
            <a className="fn-featured-cta" href={room.href}>{room.action} <ArrowRight size={16} aria-hidden="true" /></a>
            {room.record && <BrandBadge brand={room.record.brand} label={room.record.label} net={false} href={room.record.href} />}
          </div>
        </li>)}
      </ul>
    </section>
  );
}
