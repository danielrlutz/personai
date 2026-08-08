import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { ApiBootstrap } from "@/components/shared/ApiBootstrap";
import { ServiceWorkerRegister } from "@/components/shared/ServiceWorkerRegister";
import "@/styles/globals.css";

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
      <body className={`${GeistSans.variable} ${GeistMono.variable} font-sans antialiased`}>
        <ServiceWorkerRegister />
        <ApiBootstrap>{children}</ApiBootstrap>
      </body>
    </html>
  );
}
