import type { Metadata } from "next";
import { WorldDemo } from "@/components/world-demo/world-demo";
import "./world-demo.css";

export const metadata: Metadata = {
  title: "Night City After Hours · Fork Night concept",
  description: "An unofficial future concept exploring creative contributions, shared stories and visible credit.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function WorldDemoPage() { return <WorldDemo />; }
