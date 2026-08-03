/** أنواع مساعدة لاختبارات E2E — تُحقن في صفحة المتصفح. */
interface Window {
  /** يضبط إطارات QR التي ترسمها الكاميرا المحاكاة. */
  __qrferrySetFrames(frames: Array<{ n: number; data: Uint8Array }>): void;
  /** البلوبات التي أنشأها التطبيق عبر URL.createObjectURL (للتحقق). */
  __qrferryBlobs: Blob[];
  /** هوك صفحة التلفزيون: معلومات الاقتران. */
  __qrferryTvInfo?: { peerId: string; passcode: string; payload: string };
  /** هوك صفحة التلفزيون: الملف المستلم (للتحقق). */
  __qrferryTvReceived?: { name: string; mime: string; size: number; bytes: number[] };
  /** هوك صفحة التلفزيون: مصفوفة وحدات QR المعروضة (لكاميرا المحاكاة). */
  __qrferryTvModules?: { n: number; data: number[] };
}
