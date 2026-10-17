"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Maximize, Minimize } from "lucide-react";

export function DemoControls({ url }: { url: string | null }) {
  const [fullscreen, setFullscreen] = useState(false);
  const [canFullscreen, setCanFullscreen] = useState(false);
  const [notice, setNotice] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setCanFullscreen(document.fullscreenEnabled);
    const update = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setNotice("Signup link copied."); }
    catch { setNotice("Select and copy the link below the QR code."); }
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setNotice("Fullscreen is unavailable in this browser."); }
  }
  return <div className="demo-controls">
    {url && <button type="button" onClick={() => void copy()}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied ? "Copied" : "Copy signup link"}</button>}
    {canFullscreen && <button type="button" onClick={() => void toggleFullscreen()}>{fullscreen ? <Minimize size={16} aria-hidden="true" /> : <Maximize size={16} aria-hidden="true" />} {fullscreen ? "Exit fullscreen" : "Fullscreen"}</button>}
    <span className="signup-sr-only" role="status">{notice}</span>
  </div>;
}
