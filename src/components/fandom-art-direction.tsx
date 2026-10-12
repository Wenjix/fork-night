import { fandomVisualStyle } from "@/lib/fandom-art-direction";
import { fandomStory } from "@/lib/fandom-stories";
import "@/app/fandom-art-direction.css";

export function FandomArtDirection({
  projectId, value, onChange,
}: {
  projectId: string;
  value?: string;
  onChange: (projectId: string, styleId: "anime" | "film") => void;
}) {
  const story = fandomStory(projectId);
  const selected = fandomVisualStyle(projectId, value);
  if (!story?.visualStyles || !selected) return null;
  return (
    <fieldset className="fandom-art-direction">
      <legend>See this story in</legend>
      <div className="fandom-art-options">
        {story.visualStyles.map(style => (
          <button
            key={style.id}
            type="button"
            aria-pressed={selected.id === style.id}
            onClick={() => onChange(projectId, style.id)}
          >
            {style.label}
          </button>
        ))}
      </div>
      <p>Same story, two prepared visual interpretations.</p>
    </fieldset>
  );
}
