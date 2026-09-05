import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MoveSync Pulse · Mobility Intelligence",
  description: "Agentic enterprise mobility operations intelligence powered by Sarvam AI.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
