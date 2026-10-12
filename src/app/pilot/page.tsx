import { SharedPilot } from "@/components/shared-pilot";
import "./pilot.css";
import "./composer.css";

export const metadata = {
  title: "Fork Night — shared stories",
  description:
    "Pick up a shared story, leave an idea, or add a two-panel moment together.",
};

export default function PilotPage() {
  return <SharedPilot />;
}
