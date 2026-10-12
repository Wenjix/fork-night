import type { Metadata } from "next";
import { CreatorReview } from "@/components/creator-review";
import "../world-demo/world-demo.css";
import "./creator-demo.css";

export const metadata: Metadata = { title: "Nika’s next story · Fork Night", description: "Compare creative alternatives, give feedback and revise a creator bible in a prepared example.", robots: { index: false, follow: false } };
export default function CreatorDemoPage() { return <CreatorReview />; }
