/**
 * إشعارات إتمام النقل: اهتزاز + نغمة صوتية (Web Audio) + إشعار نظام
 * (Notification API) عند الاكتمال — حتى يتمكن المستخدم من ترك الجهاز.
 * كل الدوال آمنة الفشل (لا تُرمى أخطاء أبداً).
 */

let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  try {
    if (!audioContext) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      audioContext = new Ctor();
    }
    return audioContext;
  } catch {
    return null;
  }
}

/** نغمة «اكتمل» قصيرة: ترددان متتابعان واضحان. */
export function playCompletionSound(): void {
  try {
    const context = getAudioContext();
    if (!context || context.state === "closed") return;
    if (context.state === "suspended") void context.resume().catch(() => undefined);

    const now = context.currentTime;
    const playTone = (freq: number, start: number, duration: number) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.05);
    };
    playTone(880, now + 0.05, 0.25);
    playTone(1320, now + 0.35, 0.4);
  } catch {
    // الصوت اختياري.
  }
}

export function vibrateCompletion(): void {
  try {
    navigator.vibrate?.([80, 40, 120]);
  } catch {
    // الاهتزاز اختياري.
  }
}

/** يطلب إذن الإشعارات مرة واحدة فقط. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (!("Notification" in window)) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    const permission = await Notification.requestPermission();
    return permission === "granted";
  } catch {
    return false;
  }
}

export function showCompletionNotification(
  title: string,
  body: string,
): void {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") {
      return;
    }
    const notification = new Notification(title, {
      body,
      tag: "qrferry-complete",
      icon: "/icons/icon-192.png",
    });
    // نُغلق الإشعار تلقائياً بعد فترة قصيرة.
    window.setTimeout(() => notification.close(), 15_000);
  } catch {
    // الإشعار اختياري.
  }
}

/** يُطلق كل إشعارات الاكتمال دفعة واحدة. */
export function notifyTransferComplete(fileName: string): void {
  vibrateCompletion();
  playCompletionSound();
  const fallback = (title: string, body: string) => {
    showCompletionNotification(title, body);
  };
  // نحاول طلب الإذن بشكل غير متزامن ثم نعرض الإشعار إن سُمح.
  void ensureNotificationPermission().then((granted) => {
    if (granted) {
      fallback("QRFerry", `${fileName} — تم الاستقبال بنجاح.`);
    }
  });
}
