"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Download,
  Play,
  Pause,
  Volume2,
  VolumeX,
  ExternalLink,
  Music2,
  RotateCcw,
  ChevronDown,
} from "lucide-react";
import { useI18n } from "../lang-provider";
import type { SaveResult } from "@/lib/save-received-file";
import { describeBrowserError, withDeadline } from "@/lib/browser-operation";
export type DisplayFile = {
  name: string;
  mime: string;
  size: number;
  url: string;
};
export type PlayerSnapshot = {
  event: string;
  ready: number;
  network: number;
  error: number | null;
  time: number;
  waitingSeconds: number;
};
export const MEDIA_WAIT_MS = 15_000;

export function ReceivedPlayer({
  file,
  onSave,
  onDownload,
  onSnapshot,
}: {
  file: DisplayFile;
  onSave: () => Promise<SaveResult>;
  onDownload: () => SaveResult;
  onSnapshot: (snapshot: PlayerSnapshot) => void;
}) {
  const { lang } = useI18n();
  const ar = lang === "ar";
  const media = useRef<HTMLMediaElement | null>(null);
  const attempt = useRef(0);
  const lastMovement = useRef({ time: -1, at: 0 });
  const [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(false);
  const [playback, setPlayback] = useState("loading"),
    [playError, setPlayError] = useState("");
  const [saveStatus, setSaveStatus] = useState(""),
    [saving, setSaving] = useState(false);
  const [showSaveOptions, setShowSaveOptions] = useState(false);
  const audio = file.mime.startsWith("audio/"),
    video = file.mime.startsWith("video/"),
    image = file.mime.startsWith("image/");
  const invalidateAttempt = useCallback(() => {
    attempt.current++;
  }, []);
  const report = useCallback(
    (event: string) => {
      const el = media.current;
      if (!el) return;
      onSnapshot({
        event,
        ready: el.readyState,
        network: el.networkState,
        error: el.error?.code ?? null,
        time: el.currentTime,
        waitingSeconds: Math.max(
          0,
          Math.floor((Date.now() - lastMovement.current.at) / 1000),
        ),
      });
    },
    [onSnapshot],
  );
  const mediaError = useCallback(() => {
    const code = media.current?.error?.code;
    setPlayback("error");
    setPlaying(false);
    setPlayError(
      ar
        ? `تعذّر تشغيل الملف (MEDIA_ERR_${code ?? "UNKNOWN"}). وصول البيانات لا يضمن دعم الترميز. جرّب إعادة تحميل المشغّل أو فتح الملف مباشرة.`
        : `Playback failed (MEDIA_ERR_${code ?? "UNKNOWN"}). Receipt does not guarantee codec support. Reload the player or open the media directly.`,
    );
    report("error");
  }, [ar, report]);
  useEffect(() => {
    lastMovement.current = {
      time: media.current?.currentTime ?? 0,
      at: Date.now(),
    };
    const poll = setInterval(() => {
      const el = media.current;
      if (!el) return;
      const now = Date.now();
      if (el.currentTime !== lastMovement.current.time) {
        lastMovement.current = { time: el.currentTime, at: now };
        if (!el.paused && !el.ended && !el.error) {
          setPlayback("playing");
          setPlaying(true);
          setPlayError("");
        }
      }
      const waiting = el.readyState === 0 || (!el.paused && !el.ended);
      if (
        waiting &&
        !el.error &&
        now - lastMovement.current.at >= MEDIA_WAIT_MS
      ) {
        setPlayback("stalled");
        setPlayError(
          ar
            ? "MEDIA_WAIT_TIMEOUT: لم يؤكد المتصفح جاهزية الصوت خلال 15 ثانية. هذا ليس دليلًا أن الملف فارغ. جرّب «إعادة تحميل المشغّل»."
            : "MEDIA_WAIT_TIMEOUT: no media readiness after 15 seconds. This does not mean the file is empty. Try Reload player.",
        );
      }
      report("poll");
    }, 1000);
    return () => {
      clearInterval(poll);
      invalidateAttempt();
    };
  }, [file.url, ar, report, invalidateAttempt]);
  const togglePlay = async () => {
    const el = media.current;
    if (!el) return;
    if (!el.paused) {
      attempt.current++;
      el.pause();
      return;
    }
    const job = ++attempt.current;
    setPlayError("");
    setPlayback("starting");
    lastMovement.current = { time: el.currentTime, at: Date.now() };
    try {
      await withDeadline(el.play(), "media-play", MEDIA_WAIT_MS);
    } catch (error) {
      if (job !== attempt.current) return;
      setPlayback("error");
      setPlaying(false);
      setPlayError(
        (ar ? "تعذّر بدء التشغيل: " : "Could not start playback: ") +
          describeBrowserError(error),
      );
      report("play-rejected");
    }
  };
  const reload = () => {
    attempt.current++;
    setPlayError("");
    setPlayback("loading");
    setPlaying(false);
    lastMovement.current = {
      time: media.current?.currentTime ?? 0,
      at: Date.now(),
    };
    media.current?.load();
    report("reload");
    void togglePlay();
  };
  const events = {
    onLoadStart: () => {
      setPlayback("loading");
      report("loadstart");
    },
    onLoadedMetadata: () => {
      setPlayback("metadata");
      report("loadedmetadata");
    },
    onCanPlay: () => {
      if (media.current?.paused) setPlayback("ready");
      setPlayError("");
      report("canplay");
    },
    onPlay: () => {
      setPlayback("starting");
      report("play-requested");
    },
    onPlaying: () => {
      setPlaying(true);
      setPlayback("playing");
      setPlayError("");
      report("playing");
    },
    onWaiting: () => {
      setPlayback("waiting");
      report("waiting");
    },
    onStalled: () => {
      setPlayback("stalled");
      report("stalled");
    },
    onPause: () => {
      setPlaying(false);
      setPlayback("paused");
      report("pause");
    },
    onEnded: () => {
      setPlaying(false);
      setPlayback("ended");
      report("ended");
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
          ? "تم طلب التنزيل، وليس تأكيد الحفظ. إذا منع المتصفح التنزيل، يظل التشغيل ومكتبة QRFerry مسارين منفصلين."
          : "Download requested, not confirmed. Browser policy controls downloads; playback and the QRFerry library are separate.",
        cancelled: ar ? "أُلغيت عملية الحفظ." : "Save cancelled.",
        unsupported: ar
          ? "المتصفح لا يعلن دعم التنزيل. يمكنك تجربة التشغيل داخل الصفحة أو جهاز آخر للحفظ."
          : "This browser does not expose downloads. Try playback here or save on another device.",
      };
      setSaveStatus(messages[result]);
    } catch (error) {
      setSaveStatus(
        (ar ? "فشل الحفظ: " : "Save failed: ") + describeBrowserError(error),
      );
    } finally {
      setSaving(false);
    }
  };
  const labels: Record<string, string> = ar
    ? {
        loading: "تحميل بيانات الصوت",
        metadata: "قُرئت بيانات الوسائط",
        ready: "جاهز للتشغيل",
        starting: "بدء التشغيل",
        playing: "قيد التشغيل",
        waiting: "انتظار بيانات الصوت",
        stalled: "تأخّر تحميل الصوت",
        paused: "متوقف مؤقتًا",
        ended: "انتهى التشغيل",
        error: "تعذّر التشغيل",
      }
    : {};
  return (
    <section
      className="tv-player"
      aria-label={ar ? "مشغّل الملف" : "File player"}
    >
      <div className="tv-file-heading">
        {audio ? (
          <span className="tv-audio-icon">
            <Music2 size={30} />
          </span>
        ) : null}
        <div>
          <p className="tv-file-name" title={file.name}>
            {file.name}
          </p>
          <p className="tv-file-size">
            <bdi>{(file.size / 1048576).toFixed(2)} MB</bdi> ·{" "}
            <bdi>{file.mime}</bdi>
          </p>
        </div>
      </div>
      <div className={`tv-media ${audio ? "tv-audio" : ""}`}>
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
              setPlayError(ar ? "تعذّر عرض الصورة." : "Image display failed.")
            }
          />
        ) : (
          <p>
            {ar
              ? "الملف جاهز. هذا النوع لا يملك مشغّلًا داخل الصفحة."
              : "File ready. This type has no in-page player."}
          </p>
        )}
      </div>
      {audio || video ? (
        <p className="tv-playback-status" role="status" data-state={playback}>
          <span className={`tv-status-dot ${playing ? "is-live" : ""}`} />
          {labels[playback] || playback}
          <small dir="ltr">{playback}</small>
          {file.size === 0 ? (ar ? " — الملف فارغ" : " — Empty file") : null}
        </p>
      ) : null}
      {playError ? (
        <p className="tv-playback-error" role="alert">
          {playError}
        </p>
      ) : null}
      <div className="tv-actions">
        {audio || video ? (
          <button
            className="tv-btn tv-primary tv-play-button"
            type="button"
            onClick={() => void togglePlay()}
          >
            {playing ? <Pause size={23} /> : <Play size={23} />}
            {playing ? (ar ? "إيقاف مؤقت" : "Pause") : ar ? "تشغيل" : "Play"}
          </button>
        ) : null}
        <button
          type="button"
          className="tv-btn tv-download-button"
          disabled={saving}
          onClick={() => void save()}
        >
          <Download size={22} />
          {saving
            ? ar
              ? "جارٍ الطلب…"
              : "Requesting…"
            : ar
              ? "تنزيل الملف"
              : "Download file"}
        </button>
        {audio || video ? (
          <button
            type="button"
            className="tv-btn tv-btn-ghost"
            onClick={() => {
              if (media.current) media.current.muted = !media.current.muted;
            }}
          >
            {muted ? <VolumeX size={22} /> : <Volume2 size={22} />}
            {muted ? (ar ? "إلغاء الكتم" : "Unmute") : ar ? "كتم" : "Mute"}
          </button>
        ) : null}
      </div>
      <div className="tv-secondary-actions">
        {audio || video ? (
          <button
            type="button"
            className="tv-btn tv-btn-ghost tv-reload-player"
            onClick={reload}
          >
            <RotateCcw size={18} />
            {ar ? "إعادة تحميل المشغّل" : "Reload player"}
          </button>
        ) : null}
        {audio || video || image ? (
          <a
            className="tv-btn tv-btn-ghost"
            href={file.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={18} />
            {ar ? "فتح الملف مباشرة" : "Open media directly"}
          </a>
        ) : null}
      </div>
      <div className="tv-save-options">
        <button
          className="tv-save-toggle tv-text-button"
          type="button"
          aria-expanded={showSaveOptions}
          aria-controls="tv-save-extra"
          onClick={() => setShowSaveOptions((v) => !v)}
        >
          <ChevronDown size={16} />
          {ar ? "خيارات حفظ إضافية" : "Additional save options"}
        </button>
        {showSaveOptions ? (
          <div id="tv-save-extra">
            <p>
              {ar
                ? "اختياري: استخدمه فقط إذا كان متصفحك يدعم اختيار المكان."
                : "Optional: only if your browser supports choosing a destination."}
            </p>
            <button
              type="button"
              className="tv-btn tv-btn-ghost"
              disabled={saving}
              onClick={() => void save(true)}
            >
              {ar ? "اختيار مكان الحفظ" : "Choose save location"}
            </button>
          </div>
        ) : null}
      </div>
      {saveStatus ? (
        <p className="tv-save-status" role="status">
          {saveStatus}
        </p>
      ) : null}
    </section>
  );
}
