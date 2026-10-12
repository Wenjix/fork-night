import type { Metadata } from "next";
import { WaitlistForm } from "@/components/waitlist-form";
import { waitlistSettings } from "@/server/waitlist-settings";
import "./signup.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Join the waitlist — Fork Night",
  description: "Get an invitation to make stories together. Join the Fork Night waitlist.",
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const { source } = await searchParams;
  const settings = waitlistSettings();
  const configured = !!(settings.SUPABASE_URL && settings.SUPABASE_SECRET_KEY);
  return <div className="signup-shell">
    <header className="signup-header"><a className="signup-brand" href="/demo" aria-label="Fork Night">fork night<span>.</span></a><a className="signup-header-link" href="/demo">Show the QR</a></header>
    <main className="signup-main">
      <div className="signup-intro"><h1>Come make<br />the <span>next part.</span></h1><p>A friend leaves an idea. You take it somewhere new. Someone else picks it up from there.</p><p>Join the waitlist for Fork Night launches and playtests.</p></div>
      <section className="signup-paper" aria-label="Join the Fork Night waitlist"><WaitlistForm source={source === "demo" ? "demo" : "signup"} configured={configured} /></section>
    </main>
    <footer className="signup-footer"><span>A story made together.</span></footer>
  </div>;
}
