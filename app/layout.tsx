import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AASMNHS - Senior High School Online Enrollment System",
  description:
    "Official Online Enrollment System for Anselmo A. Sandoval Memorial National High School Grade 11 students.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col overflow-x-clip bg-[#eaf5ec] text-[#06281b]">
        {children}
      </body>
    </html>
  );
}
