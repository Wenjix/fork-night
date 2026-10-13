import { SharedPilot } from "@/components/shared-pilot";
import { PilotAccountProvider } from "@/components/pilot-account";
import "./pilot.css";
import "./composer.css";
import "./releases.css";

export const metadata = {
  title: "Fork Night — shared stories",
  description:
    "Pick up a shared story, leave an idea, or make the next moment together.",
};

export default function PilotPage() {
  return <PilotAccountProvider><SharedPilot /></PilotAccountProvider>;
}
