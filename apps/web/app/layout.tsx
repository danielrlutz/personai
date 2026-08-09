import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { ApiBootstrap } from "@/components/shared/ApiBootstrap";
import { ServiceWorkerRegister } from "@/components/shared/ServiceWorkerRegister";
import "@/styles/globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "PersonAI OS",
  description: "Personal AI operating system for finance, legal, medical, and daily briefings",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "PersonAI OS",
  },
  icons: {
    icon: "/icon-192.png",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a73e8",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de-CH" className="dark">
      <body
        className={`${plusJakarta.variable} ${GeistMono.variable} font-sans antialiased`}
      >
        <ServiceWorkerRegister />
        <ApiBootstrap>{children}</ApiBootstrap>
      </body>
    </html>
  );
}
