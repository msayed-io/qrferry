/**
 * متتبع استقرار الإشارة: بدل محاولة قياس اهتزاز الكاميرا (صعب وغير موثوق
 * عبر مقارنة الإطارات لأن محتوى QR يتغير كل إطار)، نعتمد على مؤشر صادق
 * وعملي: نسبة نجاح فك الرموز خلال نافذة زمنية. إذا ظل المتصفح يفكك
 * الإطارات باستمرار دون إخفاقات كثيرة، فالإشارة مستقرة والجهاز جاهز
 * ليتركه المستخدم.
 */

export type StabilitySample = {
  success: boolean;
};

export type StabilityState = {
  stable: boolean;
  /** نسبة النجاح خلال النافذة (0..1). */
  successRate: number;
  /** عدد المحاولات داخل النافذة. */
  attempts: number;
};

const WINDOW_SIZE = 14;
const STABLE_THRESHOLD = 0.85;
const MIN_ATTEMPTS = 6;

export class StabilityTracker {
  private samples: StabilitySample[] = [];

  /** يسجّل نتيجة محاولة فك واحدة. */
  push(success: boolean): void {
    this.samples.push({ success });
    if (this.samples.length > WINDOW_SIZE) this.samples.shift();
  }

  get state(): StabilityState {
    const attempts = this.samples.length;
    if (attempts === 0) {
      return { stable: false, successRate: 0, attempts: 0 };
    }
    const successes = this.samples.filter((sample) => sample.success).length;
    const successRate = successes / attempts;
    return {
      stable: attempts >= MIN_ATTEMPTS && successRate >= STABLE_THRESHOLD,
      successRate,
      attempts,
    };
  }

  reset(): void {
    this.samples = [];
  }
}

/** دالة مساعدة بسيطة: هل الإشارة مستقرة حسب عيّنة وحيدة. */
export function isStableFromRate(successes: number, attempts: number): boolean {
  if (attempts < MIN_ATTEMPTS) return false;
  return successes / attempts >= STABLE_THRESHOLD;
}
