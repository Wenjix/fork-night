import { PilotExperience } from "@/components/pilot-experience";
import { PilotAccountProvider } from "@/components/pilot-account";
import "./pilot.css";
import "./rooms.css";
import "./composer.css";
import "./releases.css";

export const metadata = {
  title: "Fork Night — shared stories",
  description:
    "Pick up a shared story, leave an idea, or make the next moment together.",
};

export default function PilotPage() {
  return <PilotAccountProvider><PilotExperience /></PilotAccountProvider>;
}
