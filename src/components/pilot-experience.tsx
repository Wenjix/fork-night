"use client";
import { useEffect, useState } from "react";
import { SharedPilot } from "./shared-pilot";
import { PilotEntrance } from "./pilot-entrance";

export function PilotExperience() {
  const [route, setRoute] = useState<string>();
  useEffect(() => {
    const sync = () => setRoute(window.location.search);
    sync(); window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function navigate(path: string) {
    window.history.pushState(null, "", path);
    setRoute(window.location.search);
  }
  if (route === undefined) return <main className="pilot-shell"><p role="status">Opening shared stories…</p></main>;
  const query = new URLSearchParams(route);
  return query.has("room") ? <SharedPilot key={query.get("room")} /> : <PilotEntrance creating={query.get("create") === "1"} navigate={navigate} />;
}
