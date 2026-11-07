import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "glisse/styles.css";
import "./globals.css";
import "./workspace.css";
import "./support.css";
import "./bridge/bridge.css";
import "./liquid-controls.css";
import { AppShell } from "./app-shell";
import { PwaRegister } from "./pwa-register";
import { LangProvider } from "./lang-provider";
import { requestLanguage } from "./device-language";

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F4F6" },
    { media: "(prefers-color-scheme: dark)", color: "#121014" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const metadataBase = new URL(host ? `${protocol}://${host}` : "https://qrferry.com");

  const ar = requestLanguage(requestHeaders.get("accept-language")) === "ar";
  return {
    metadataBase,
    title: {
      default: ar ? "QRFerry · نقل الملفات عبر الكاميرا" : "QRFerry · Files across devices",
      template: "%s",
    },
    description:
      ar ? "نقل ملفات خاص وموثوق بين شاشة وكاميرا عبر بثّ أكواد QR متحركة، دون رفع الملف إلى أي خادم." : "Private file transfers between a screen and a camera using animated QR codes, without uploading the file to a server.",
    applicationName: "QRFerry",
    manifest: "/manifest.webmanifest",
    openGraph: {
      title: "QRFerry",
      description: ar ? "ملفات عبر الكاميرا — دون إنترنت ودون خوادم." : "Files through your camera — no internet or servers required.",
      type: "website",
      images: [{ url: "/og.png", width: 1732, height: 908, alt: ar ? "QRFerry — نقل الملفات عبر الكاميرا" : "QRFerry — files through your camera" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "QRFerry",
      description: ar ? "ملفات عبر الكاميرا — دون إنترنت ودون خوادم." : "Files through your camera — no internet or servers required.",
      images: ["/og.png"],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "QRFerry",
    },
    formatDetection: {
      telephone: false,
    },
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
        { url: "/favicon.svg", type: "image/svg+xml" },
      ],
      shortcut: "/favicon.svg",
      apple: "/icons/icon-192.png",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const lang = requestLanguage((await headers()).get("accept-language"));
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} suppressHydrationWarning>
      <body>
        <LangProvider initialLang={lang}>
          <PwaRegister />
          <AppShell>{children}</AppShell>
        </LangProvider>
      </body>
    </html>
  );
}
