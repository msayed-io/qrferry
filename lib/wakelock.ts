/**
 * Wake Lock: يمنع نوم شاشة الجهاز أثناء النشاط (استقبال/إرسال) حتى لا
 * ينقطع النقل عندما يترك المستخدم الجهاز. يرجع null بأمان إن لم يُدعم.
 */

export type ScreenWakeLockHandle = {
  release: () => Promise<void>;
};

export async function requestScreenWakeLock(): Promise<ScreenWakeLockHandle | null> {
  try {
    const nav = navigator as Navigator & {
      wakeLock?: {
        request(type: "screen"): Promise<{ release: () => Promise<void> }>;
      };
    };
    if (!nav.wakeLock) return null;
    const lock = await nav.wakeLock.request("screen");
    return { release: () => lock.release() };
  } catch {
    // غير مدعوم أو مرفوض — نستمر دون منع نوم.
    return null;
  }
}

/** يمنع النوم ويُعيد دالة التحرير، أو null عند الفشل. */
export async function acquireScreenWakeLock(): Promise<() => void> {
  const handle = await requestScreenWakeLock();
  return () => {
    void handle?.release().catch(() => undefined);
  };
}
