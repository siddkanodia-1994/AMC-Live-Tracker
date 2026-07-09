import type { Metadata } from "next";
import { Geist, Geist_Mono, Carlito, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { ExportProvider } from "@/components/layout/export-context";
import { Toaster } from "@/components/ui/sonner";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Calibri isn't a licensed web font, so it only renders for visitors who
// already have it installed locally (common on Windows/Office machines).
// Carlito is a free, metrically-identical substitute -- loading it here
// means everyone else sees something visually indistinguishable from
// Calibri instead of falling through to a generic system sans-serif.
const carlito = Carlito({
  variable: "--font-carlito",
  weight: ["400", "700"],
  subsets: ["latin"],
});

// Serif used for AMC names in the dashboard tables (variable font, all
// weights available without listing them).
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AMC Live AUM Tracker",
  description: "Live-repriced AUM for Indian equity mutual fund AMCs",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${carlito.variable} ${sourceSerif.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          <ExportProvider>
            <Header />
            <main className="flex-1">{children}</main>
            <Footer />
            <Toaster />
          </ExportProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
