/** أنواع مساعدة لاختبارات E2E — تُحقن في صفحة المتصفح. */
interface Window {
  /** يضبط إطارات QR التي ترسمها الكاميرا المحاكاة. */
  __qrferrySetFrames(frames: Array<{ n: number; data: Uint8Array }>): void;
  /** البلوبات التي أنشأها التطبيق عبر URL.createObjectURL (للتحقق). */
  __qrferryBlobs: Blob[];
}
