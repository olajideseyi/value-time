import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Value Time — Make every moment count",
  description: "Your personal timetable, tasks, assignments and smart reminders in one place.",
  manifest: "/manifest.webmanifest",
  themeColor: "#101a2c",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
