import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.msayed.qrferry',
  appName: 'QRFerry',
  webDir: 'www',
  server: {
    // The production web app remains the authoritative Next.js runtime.
    // Override this for a private deployment or local device testing.
    url: process.env.CAPACITOR_SERVER_URL ?? 'https://qrferry-phi.vercel.app',
    cleartext: false,
  },
};

export default config;
