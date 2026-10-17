import { ArrowRight, ExternalLink } from "lucide-react";
import { featuredRooms } from "@/lib/featured-stories";
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
            <p className="fn-featured-focus">{room.focus}</p>
            <p className="fn-featured-description">{room.description}</p>
            <p className="fn-featured-status">{room.status}</p>
          </div>
          <div className="fn-featured-actions">
            <a className="fn-featured-cta" href={room.href}>{room.action} <ArrowRight size={16} aria-hidden="true" /></a>
            {room.record && <a className="fn-featured-record" href={room.record.href} target="_blank" rel="noreferrer">
              {room.record.label}<ExternalLink size={13} aria-hidden="true" /><span className="sr-only"> (opens in a new tab)</span>
            </a>}
          </div>
        </li>)}
      </ul>
    </section>
  );
}
