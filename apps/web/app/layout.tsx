import type { Metadata, Viewport } from "next";
import { Fraunces, Plus_Jakarta_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { ApiBootstrap } from "@/components/shared/ApiBootstrap";
import { ServiceWorkerRegister } from "@/components/shared/ServiceWorkerRegister";
import { ThemeProvider } from "@/components/shared/ThemeProvider";
import { AppLockGate } from "@/components/shared/AppLockGate";
import "@/styles/globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PersonAI OS",
  description: "Private desk for triage, specialists, archive, money, and Fristen",
  applicationName: "PersonAI OS",
  // Prefer application/manifest+json MIME via nginx; .json kept as fallback.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PersonAI OS",
  },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#2f6f5e",
  colorScheme: "dark light",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de-CH" className="dark" suppressHydrationWarning>
      <body
        className={`${plusJakarta.variable} ${fraunces.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        <ServiceWorkerRegister />
        <ThemeProvider>
          <ApiBootstrap>
            <AppLockGate>{children}</AppLockGate>
          </ApiBootstrap>
        </ThemeProvider>
      </body>
    </html>
  );
}
