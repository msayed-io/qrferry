"use client";

import {
  Camera,
  HardDrive,
  Lock,
  Network,
  ShieldCheck,
  Monitor,
} from "lucide-react";
import { useI18n } from "../lang-provider";
import { SupportShell } from "../support-shell";

export function PrivacyClient() {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const sections = [
    {
      Icon: Network,
      title: ar ? "كيف تنتقل الملفات؟" : "How files travel",
      text: ar
        ? "النقل البصري يمر من الشاشة إلى الكاميرا، دون شبكة أثناء النقل. النقل السريع يستخدم WebRTC بين الجهازين، ويستعين بخادم تسيير للاقتران؛ افتراضيًا قد يتصل بخدمات شبكة عامة. يمكن إعداد خادم تسيير محلي للشبكات المعزولة."
        : "Optical transfer goes from screen to camera, without a network during transfer. Fast transfer uses WebRTC between devices and a signaling server for pairing; by default it may contact public network services. An isolated network can use a local signaling server.",
    },
    {
      Icon: Monitor,
      title: ar ? "المعالجة داخل جهازك" : "Processing on your device",
      text: ar
        ? "الضغط والترميز والتشفير وفك الرموز والتحقق تتم في المتصفح. لا يرفع التطبيق محتوى ملفاتك إلى خادم استضافة الموقع. لا يتطلب حسابًا، ولا يتضمن أدوات تحليلات أو إعلانات."
        : "Compression, encoding, encryption, decoding and verification run in your browser. The app does not upload file contents to the website’s hosting server. It requires no account and includes no analytics tools or ads.",
    },
    {
      Icon: Camera,
      title: ar ? "إذن الكاميرا" : "Camera permission",
      text: ar
        ? "تُستخدم الكاميرا لقراءة رموز النقل أو الاقتران أو كلمة المرور. تُعالج اللقطات في الذاكرة؛ لا يسجّل التطبيق الفيديو ولا يرسله إلى خادم. يمكنك إيقاف الكاميرا أو سحب الإذن من إعدادات المتصفح."
        : "The camera reads transfer, pairing or password codes. Frames are processed in memory; the app does not record video or send it to a server. Stop the camera or revoke permission in your browser settings.",
    },
    {
      Icon: HardDrive,
      title: ar ? "ما الذي يُحفظ محليًا؟" : "What is stored locally?",
      text: ar
        ? "يُحفظ سجل النقل وتفضيلاتك والمفاتيح الموثوقة وبيانات الاستئناف في المتصفح. قد تحتفظ مكتبة التلفزيون بالملفات المستلمة نفسها. كاش التطبيق يحفظ أصول الواجهة، لا الملفات المنقولة. التنزيلات تُحفظ بصورة منفصلة وفق إعدادات المتصفح."
        : "Transfer history, preferences, trusted keys and resume data are kept in the browser. The TV library may retain received files themselves. The app cache stores interface assets, not transferred files. Downloads are saved separately according to browser settings.",
    },
    {
      Icon: Lock,
      title: ar ? "التشفير والسرية" : "Encryption and privacy",
      text: ar
        ? "يمكن تشفير الحمولة بكلمة مرور باستخدام AES-256. احتفظ بكلمة المرور وشاركها بشكل آمن. رموز النقل البصري ليست سرّية تلقائيًا: من يستطيع تصويرها قد يقرأ المحتوى إن لم يكن مشفّرًا."
        : "You can password-encrypt the payload using AES-256. Keep the password and share it securely. Optical codes are not private by default: someone who captures them may read content that is not encrypted.",
    },
    {
      Icon: ShieldCheck,
      title: ar ? "التحكم في بياناتك" : "Control your data",
      text: ar
        ? "زر مسح السجل يحذف بيانات السجل فقط، لا تنزيلاتك ولا مكتبة التلفزيون. يمكنك إدارة المكتبة من صفحة التلفزيون، أو حذف بيانات الموقع من المتصفح. حذف بيانات الموقع قد يزيل ملفات المكتبة وبيانات الاستئناف؛ احتفظ بنسخة مما تحتاجه أولًا."
        : "Clear history removes only history records, not downloads or the TV library. Manage the library on the TV page or clear site data in your browser. Clearing site data may remove library files and resume data; save a copy of what you need first.",
    },
  ];
  return (
    <SupportShell
      active="privacy"
      title={ar ? "سياسة الخصوصية" : "Privacy policy"}
      description={
        ar
          ? "كيف يستخدم التطبيق الكاميرا والشبكة والتخزين على جهازك."
          : "How the app uses your camera, network and local storage."
      }
    >
      <p className="support-updated">
        {ar ? "آخر تحديث:" : "Updated:"}{" "}
        <time dateTime="2026-09-18">
          {ar ? "18 سبتمبر 2026" : "September 18, 2026"}
        </time>
      </p>
      <div className="privacy-grid">
        {sections.map(({ Icon, title, text }, index) => (
          <section className="support-card" key={index}>
            <div className="support-card-heading">
              <h2>
                <Icon size={23} aria-hidden="true" />
                {title}
              </h2>
              <span className="support-number" aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
            </div>
            <p>{text}</p>
          </section>
        ))}
      </div>
    </SupportShell>
  );
}
