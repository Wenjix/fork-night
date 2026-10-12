import type { Metadata } from "next";
import { ArrowRight } from "lucide-react";
import QRCode from "qrcode";
import { signupUrl } from "@/lib/waitlist";
import { waitlistSettings } from "@/server/waitlist-settings";
import { DemoControls } from "@/components/demo-controls";
import "../signup/signup.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Join the story — Fork Night",
  description: "Scan to join the Fork Night waitlist. Stories made together.",
};

export default async function DemoPage() {
  const url = signupUrl(waitlistSettings());
  const svg = url ? await QRCode.toString(url, {
    type: "svg", errorCorrectionLevel: "M", margin: 4, width: 480,
    color: { dark: "#000000", light: "#ffffff" },
  }) : null;
  const signupPath = url ?? "/signup?source=demo";
  return <div className="signup-shell demo-screen">
    <header className="signup-header">
      <a className="signup-brand" href="/demo" aria-label="Fork Night">fork night<span>.</span></a>
      <DemoControls url={url} />
    </header>
    <main className="demo-main">
      <div className="demo-invitation">
        <h1>Good stories<br />need <span>company.</span></h1>
        <p>Make something strange together.<br />Join the Fork Night waitlist.</p>
        <a className="signup-button" href={signupPath}>Join the waitlist <ArrowRight size={22} aria-hidden="true" /></a>
      </div>
      <figure className="demo-code">
        {svg ? <>
          <a className="demo-qr-link" href={url!} aria-label="Open the Fork Night signup page">
            <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} width={480} height={480} alt="QR code to join the Fork Night waitlist" />
          </a>
          <figcaption><strong>Scan to join the story.</strong><a href={url!}>{new URL(url!).host}/signup</a></figcaption>
        </> : <div className="demo-setup">
          <h2>The invitation is almost ready.</h2>
          <p>The QR appears here when a public address is connected. You can preview the signup on this device now.</p>
          <a href="/signup?source=demo">Preview the signup <ArrowRight size={18} aria-hidden="true" /></a>
        </div>}
      </figure>
    </main>
    <footer className="signup-footer"><span>Your next idea could be someone else’s next chapter.</span><span>A story made together.</span></footer>
  </div>;
}
