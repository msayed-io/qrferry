import type { Metadata } from "next";
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

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const metadataBase = new URL(host ? `${protocol}://${host}` : "https://qrferry.com");

  return {
    metadataBase,
    title: {
      default: "QRFerry · نقل الملفات عبر الكاميرا",
      template: "%s",
    },
    description:
      "نقل ملفات خاص وموثوق بين شاشة وكاميرا عبر بثّ أكواد QR متحركة، دون رفع الملف إلى أي خادم.",
    applicationName: "QRFerry",
    manifest: "/manifest.webmanifest",
    openGraph: {
      title: "QRFerry",
      description: "ملفات عبر الكاميرا — دون إنترنت ودون خوادم.",
      type: "website",
      images: [{ url: "/og.png", width: 1732, height: 908, alt: "QRFerry — نقل الملفات عبر الكاميرا" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "QRFerry",
      description: "ملفات عبر الكاميرا — دون إنترنت ودون خوادم.",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ar" dir="rtl" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("qrferry-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}` }} />
        <LangProvider>
          <PwaRegister />
          <AppShell>{children}</AppShell>
        </LangProvider>
      </body>
    </html>
  );
}
