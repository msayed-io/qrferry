"use client";
import { useRef, useState } from "react";
import {
  Download,
  Play,
  Pause,
  Volume2,
  VolumeX,
  ExternalLink,
} from "lucide-react";
import { useI18n } from "../lang-provider";
import type { SaveResult } from "@/lib/save-received-file";
export type DisplayFile = {
  name: string;
  mime: string;
  size: number;
  url: string;
};

export function ReceivedPlayer({
  file,
  onSave,
  onDownload,
}: {
  file: DisplayFile;
  onSave: () => Promise<SaveResult>;
  onDownload: () => SaveResult;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const media = useRef<HTMLMediaElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [playback, setPlayback] = useState("loading");
  const [playError, setPlayError] = useState("");
  const [saveStatus, setSaveStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const audio = file.mime.startsWith("audio/"),
    video = file.mime.startsWith("video/"),
    image = file.mime.startsWith("image/");
  const mediaError = () => {
    const code = media.current?.error?.code;
    setPlayback("error");
    setPlaying(false);
    setPlayError(
      ar
        ? `تعذّر تشغيل الملف في هذا المتصفح (MEDIA_ERR_${code ?? "UNKNOWN"}). استلام البيانات لا يعني دعم الترميز الصوتي. جرّب MP3 أو ملفًا متوافقًا مع جهازك؛ إعادة الإرسال وحدها لن تغيّر الترميز.`
        : `Playback failed (MEDIA_ERR_${code ?? "UNKNOWN"}). Receipt does not imply codec support. Try a device-supported format; resending does not transcode the file.`,
    );
  };
  const togglePlay = async () => {
    const el = media.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    setPlayError("");
    try {
      await el.play();
    } catch (cause) {
      setPlayback("error");
      setPlaying(false);
      const name = cause instanceof Error ? cause.name : "PlaybackError";
      setPlayError(
        ar
          ? `لم يسمح المتصفح بتشغيل الصوت (${name}). استخدم عناصر المشغّل أو افتح الملف مباشرة. إذا استمر الرفض، فالملف أو ترميزه غير مدعوم على هذا الجهاز.`
          : `Playback rejected (${name}). Use the native controls or open the media directly. If it persists, check device codec support.`,
      );
    }
  };
  const events = {
    onLoadedMetadata: () => setPlayback("metadata"),
    onCanPlay: () => setPlayback("ready"),
    onPlay: () => {
      setPlaying(true);
      setPlayback("playing");
      setPlayError("");
    },
    onPause: () => {
      setPlaying(false);
      setPlayback("paused");
    },
    onEnded: () => {
      setPlaying(false);
      setPlayback("ended");
    },
    onError: mediaError,
    onVolumeChange: () => setMuted(media.current?.muted ?? false),
  };
  const save = async (chooseLocation = false) => {
    setSaving(true);
    setSaveStatus("");
    try {
      const result = await (chooseLocation ? onSave() : onDownload());
      const messages = {
        saved: ar
          ? "تم الحفظ في المكان الذي اخترته."
          : "Saved to the chosen location.",
        requested: ar
          ? "تم طلب التنزيل من المتصفح، وليس تأكيد حفظه. إذا لم يظهر تنزيل على الشاشة، فمتصفحها قد يمنع حفظ الملفات. مكتبة QRFerry منفصلة عن ملفات الجهاز؛ استخدم USB أو جهازًا يدعم التنزيل عند الحاجة."
          : "Download requested, not confirmed. Some TV browsers block file downloads. The QRFerry library is separate from the device filesystem; use USB or a download-capable device if needed.",
        cancelled: ar ? "أُلغيت عملية الحفظ." : "Save cancelled.",
        unsupported: ar
          ? "هذا المتصفح لا يعلن دعم تنزيل الملفات. يمكنك التشغيل داخل الصفحة إن كان الترميز مدعومًا، أو استخدام USB/جهاز آخر للحفظ."
          : "This browser does not expose file downloads. Play here if supported, or use USB/another device for saving.",
      };
      setSaveStatus(messages[result]);
    } catch (cause) {
      setSaveStatus(
        (ar ? "فشل الحفظ: " : "Save failed: ") +
          (cause instanceof Error ? cause.message : String(cause)),
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <p className="tv-file-name">{file.name}</p>
      <p className="tv-file-size">
        {file.size.toLocaleString()} {ar ? "بايت" : "bytes"} ·{" "}
        <bdi>{file.mime}</bdi>
      </p>
      <div className="tv-media">
        {audio ? (
          <audio
            ref={(node) => {
              media.current = node;
            }}
            src={file.url}
            controls
            preload="metadata"
            {...events}
          />
        ) : video ? (
          <video
            ref={(node) => {
              media.current = node;
            }}
            src={file.url}
            controls
            playsInline
            preload="metadata"
            {...events}
          />
        ) : image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.url}
            alt={file.name}
            onError={() =>
              setPlayError(
                ar
                  ? "تعذّر عرض الصورة؛ جرّب حفظها على جهاز يدعمها."
                  : "Image display failed.",
              )
            }
          />
        ) : (
          <p>
            {ar
              ? "وصل الملف، لكنه ليس نوع وسائط معروفًا للمشغّل. يمكنك محاولة حفظه."
              : "Received. This is not a recognized media type; you can try saving it."}
          </p>
        )}
      </div>
      {audio || video ? (
        <p className="tv-playback-status" role="status">
          {ar ? "حالة المشغّل: " : "Player: "}
          <bdi>{playback}</bdi>
          {file.size === 0
            ? ar
              ? " — الملف فارغ، لا يحتوي صوتًا."
              : " — Empty file, no audio."
            : null}
        </p>
      ) : null}
      {playError ? (
        <p className="tv-playback-error" role="alert">
          {playError}
        </p>
      ) : null}
      <div className="tv-actions">
        <button
          type="button"
          className="tv-btn"
          disabled={saving}
          onClick={() => void save()}
        >
          <Download size={20} />
          {saving
            ? ar
              ? "جارٍ الطلب…"
              : "Requesting…"
            : ar
              ? "تنزيل الملف"
              : "Download file"}
        </button>
        {audio || video ? (
          <>
            <button
              type="button"
              className="tv-btn tv-btn-ghost"
              onClick={() => void togglePlay()}
            >
              {playing ? <Pause size={20} /> : <Play size={20} />}{" "}
              {playing ? (ar ? "إيقاف مؤقت" : "Pause") : ar ? "تشغيل" : "Play"}
            </button>
            <button
              type="button"
              className="tv-btn tv-btn-ghost"
              onClick={() => {
                if (media.current) media.current.muted = !media.current.muted;
              }}
            >
              {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}{" "}
              {muted ? (ar ? "إلغاء الكتم" : "Unmute") : ar ? "كتم" : "Mute"}
            </button>
          </>
        ) : null}
        {audio || video || image ? (
          <a
            className="tv-btn tv-btn-ghost"
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={20} />
            {ar ? "فتح الملف مباشرة" : "Open media directly"}
          </a>
        ) : null}
      </div>
      <details className="tv-save-options">
        <summary>
          {ar ? "خيارات حفظ إضافية" : "Additional save options"}
        </summary>
        <p>
          {ar
            ? "اختيار مكان الحفظ اختياري، ولا يُستخدم في التنزيل التلقائي أو زر التنزيل."
            : "Choosing a save location is optional and never used by automatic or direct downloads."}
        </p>
        <button
          type="button"
          className="tv-btn tv-btn-ghost"
          disabled={saving}
          onClick={() => void save(true)}
        >
          {ar ? "اختيار مكان الحفظ" : "Choose save location"}
        </button>
      </details>
      {saveStatus ? (
        <p className="tv-save-status" role="status">
          {saveStatus}
        </p>
      ) : null}
    </>
  );
}
