import type { Metadata } from "next";
import { WrenStudio } from "@/components/wren-studio/wren-studio";
import "./wren-studio.css";

export const metadata: Metadata = {
  title: "Make your Wren · Fork Night",
  description: "A game-style character maker for your own Wren, Fork Night's AI agent.",
  robots: { index: false, follow: false },
};

export default function WrenStudioPage() {
  return <WrenStudio />;
}
