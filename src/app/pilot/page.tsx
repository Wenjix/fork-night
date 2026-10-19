import { PilotExperience } from "@/components/pilot-experience";
import { PilotAccountProvider } from "@/components/pilot-account";
import "../featured-stories.css";
import "./pilot.css";
import "./rooms.css";
import "./home.css";
import "./composer.css";
import "./releases.css";
import "./kessler.css";
import "./films.css";
import "./overview.css";

export const metadata = {
  title: "Fork Night — shared stories",
  description:
    "Pick up a shared story, leave an idea, or make the next moment together.",
};

export default function PilotPage() {
  return <PilotAccountProvider><PilotExperience /></PilotAccountProvider>;
}
