let notificationAudioContext: AudioContext | null = null;

export type BridgeNotificationPermission = NotificationPermission | "unsupported";

export async function requestBridgeNotificationPermission(): Promise<BridgeNotificationPermission> {
  if (typeof window === "undefined" || typeof Notification === "undefined") {
    return "unsupported";
  }
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function notifyBridgeIncoming(title: string, body: string): void {
  if (
    typeof window === "undefined" ||
    typeof Notification === "undefined" ||
    Notification.permission !== "granted"
  ) {
    return;
  }
  if (!document.hidden && document.hasFocus()) return;
  try {
    new Notification(title, {
      body,
      icon: "/favicon.svg",
      tag: "qrferry-bridge-incoming",
    });
  } catch {
    // بعض المتصفحات تمنع الإشعار في سياقات غير آمنة أو بعد سحب الإذن.
  }
}

export function playBridgeNotificationTone(kind: "message" | "file"): void {
  if (typeof window === "undefined") return;
  const AudioContextCtor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) return;
  try {
    notificationAudioContext ??= new AudioContextCtor();
    const context = notificationAudioContext;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(kind === "file" ? 660 : 520, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === "file" ? 880 : 700,
      now + 0.12,
    );
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.25);
    void context.resume().catch(() => undefined);
  } catch {
    // الصوت تحسين اختياري؛ لا ينبغي أن يؤثر على الاتصال أو النقل.
  }
}
