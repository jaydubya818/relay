import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./owner-workspace.css";

export const metadata: Metadata = {
  title: { default: "Relay", template: "%s · Relay" },
  description: "The durable capability plane for AI agents.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
