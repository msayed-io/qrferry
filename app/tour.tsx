"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./lang-provider";

const TOUR_STORAGE_KEY = "qrferry-tour-seen-v1";

/**
 * جولة تعليمية قصيرة تظهر عند أول استخدام (مرة واحدة فقط)،
 * تشرح خطوات الإرسال والاستقبال بمستطيلات متتابعة.
 */
export function Tour() {
  const { lang } = useI18n();
  const [step, setStep] = useState<number | null>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(TOUR_STORAGE_KEY) === "1") return;
      const timer = window.setTimeout(() => setStep(0), 1200);
      return () => window.clearTimeout(timer);
    } catch {
      // تجاهل
    }
  }, []);

  const close = () => {
    setStep(null);
    try {
      localStorage.setItem(TOUR_STORAGE_KEY, "1");
    } catch {
      // تجاهل
    }
  };

  if (step === null) return null;

  const steps = [
    { title: lang === "ar" ? "١) اختر ملفاً" : "1) Choose a file", body: lang === "ar"
      ? "من الصفحة الرئيسية اختر ملفاً أو أكثر — أو الصق نصاً — وسيُضغط ويُرمَّز داخل متصفحك."
      : "From the home page pick one or more files — or paste text — and it will be compressed and encoded inside your browser." },
    { title: lang === "ar" ? "٢) ابدأ البث" : "2) Start the stream", body: lang === "ar"
      ? "اضغط «ابدأ بثّ QR» وستظهر أكواد QR متحركة على الشاشة. اختر وضعاً أبطأ للثبات أو أسرع للسرعة."
      : "Press “Start QR stream” and animated QR codes appear on screen. Pick a slower mode for stability or a faster one for speed." },
    { title: lang === "ar" ? "٣) افتح المسح على الموبايل" : "3) Open Scan on the phone", body: lang === "ar"
      ? "على الهاتف افتح /scan واسمح بالوصول إلى الكاميرا الخلفية."
      : "On the phone open /scan and allow access to the rear camera." },
    { title: lang === "ar" ? "٤) ثبّت وانتظر" : "4) Hold steady and wait", body: lang === "ar"
      ? "أبقِ الكود كاملاً داخل الإطار حتى يكتمل الاستقبال. الفقد لا يضر — RaptorQ يعيد البناء."
      : "Keep the full code inside the guide until receiving completes. Loss doesn't matter — RaptorQ rebuilds it." },
    { title: lang === "ar" ? "٥) الخصوصية أولاً" : "5) Privacy first", body: lang === "ar"
      ? "لا يغادر ملفك جهازك أبداً. فعّل التشفير لمزيد من السرية."
      : "Your file never leaves your device. Enable encryption for extra secrecy." },
  ];

  const current = steps[step];

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-label={current.title}>
      <div className="tour-card">
        <span className="tour-step">{step + 1} / {steps.length}</span>
        <h3>{current.title}</h3>
        <p>{current.body}</p>
        <div className="tour-actions">
          <button type="button" className="tour-skip" onClick={close}>
            {lang === "ar" ? "تخطَّ الجولة" : "Skip tour"}
          </button>
          <button
            type="button"
            className="tour-next"
            onClick={() => (step < steps.length - 1 ? setStep(step + 1) : close())}
          >
            {step < steps.length - 1
              ? lang === "ar" ? "التالي" : "Next"
              : lang === "ar" ? "ابدأ" : "Start"}
          </button>
        </div>
      </div>
    </div>
  );
}
