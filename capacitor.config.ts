import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.msayed.qrferry',
  appName: 'QRFerry',
  webDir: 'www',
  // SystemChrome owns native insets; never pad the same bars again in CSS.
  plugins: { SystemBars: { insetsHandling: 'disable', style: 'DEFAULT', hidden: false } },
};

export default config;
