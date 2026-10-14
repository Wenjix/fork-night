import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import "./room-networks.css";
import "./guild-funding.css";

const interfaceFont = localFont({
  src: "../../public/fonts/inter-latin.woff2",
  variable: "--font-interface",
  display: "swap",
  weight: "100 900",
});

const displayFont = localFont({
  src: "../../public/fonts/bricolage-grotesque.woff2",
  variable: "--font-display",
  display: "swap",
  weight: "200 800",
});

export const metadata: Metadata = {
  title: "Fork Night — a story made together",
  description:
    "Build on a friend's idea. Make the next moment yours. Fork Night local prototype.",
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${interfaceFont.variable} ${displayFont.variable}`}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
