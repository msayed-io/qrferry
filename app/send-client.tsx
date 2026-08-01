"use client";

import {
  ChangeEvent,
  DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { compressForTransfer, CompressionMode } from "@/lib/compression";
import { encryptPayload } from "@/lib/encryption";
import {
  buildOpticalContainer,
  createOpticalTransfer,
  formatBytes,
  formatRate,
  MAX_FILE_BYTES,
  OpticalTransfer,
  PreparedOpticalFile,
} from "@/lib/optical-transfer";
import {
  TRANSFER_PRESETS,
  TransferPresetKey,
} from "@/lib/transfer-presets";

type PreparedFile = {
  file: File;
  original: Uint8Array;
  compressedBytes: Uint8Array;
  compressedMode: CompressionMode;
  optical: PreparedOpticalFile;
};

/** الأجزاء اللازمة لإعادة بناء الحاوية البصرية (مع أو بدون تشفير). */
type PreparedFileParts = Pick<
  PreparedFile,
  "file" | "original" | "compressedBytes" | "compressedMode"
>;

function evenlyInterleave(source: number[], repair: number[]) {
  if (source.length === 0) return [...repair];
  if (repair.length === 0) return [...source];
  const order: number[] = [];
  let repairIndex = 0;
  let accumulator = 0;
  for (const sourceIndex of source) {
    order.push(sourceIndex);
    accumulator += repair.length;
    while (repairIndex < repair.length && accumulator >= source.length) {
      order.push(repair[repairIndex]);
      repairIndex += 1;
      accumulator -= source.length;
    }
  }
  while (repairIndex < repair.length) {
    order.push(repair[repairIndex]);
    repairIndex += 1;
  }
  return order;
}

function estimateDuration(
  transfer: OpticalTransfer,
  preset: (typeof TRANSFER_PRESETS)[TransferPresetKey],
) {
  const seconds = transfer.sourcePacketCount / (preset.fps * 0.78);
  if (seconds < 60) return `حوالي ${Math.max(1, Math.ceil(seconds))} ثانية`;
  const minutes = seconds / 60;
  return `حوالي ${minutes >= 10 ? Math.ceil(minutes) : minutes.toFixed(1)} دقيقة`;
}

export function SendClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  const qrStageRef = useRef<HTMLDivElement>(null);
  const transferRef = useRef<OpticalTransfer | undefined>(undefined);
  const orderRef = useRef<number[]>([]);
  const playedFramesRef = useRef(0);
  const broadcastFrameTimesRef = useRef<number[]>([]);
  const encodeJobRef = useRef(0);
  const [fileData, setFileData] = useState<PreparedFile>();
  const [transfer, setTransfer] = useState<OpticalTransfer>();
  const [presetKey, setPresetKey] = useState<TransferPresetKey>("robust");
  const [playing, setPlaying] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [playedFrames, setPlayedFrames] = useState(0);
  const [actualFps, setActualFps] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [encryptEnabled, setEncryptEnabled] = useState(false);
  const [password, setPassword] = useState("");
  const preset = TRANSFER_PRESETS[presetKey];

  const installTransfer = useCallback((next: OpticalTransfer) => {
    const order = evenlyInterleave(
      next.sourcePacketIndices,
      next.repairPacketIndices,
    );
    transferRef.current = next;
    orderRef.current = order;
    playedFramesRef.current = 0;
    setPlayedFrames(0);
    setTransfer(next);
  }, []);

  const encodePrepared = useCallback(
    async (
      prepared: PreparedFile,
      nextPresetKey: TransferPresetKey,
    ) => {
      const job = encodeJobRef.current + 1;
      encodeJobRef.current = job;
      setProcessing(true);
      setError("");
      try {
        const nextPreset = TRANSFER_PRESETS[nextPresetKey];
        const next = await createOpticalTransfer(prepared.optical, {
          symbolSize: nextPreset.symbolSize,
          repairPercent: nextPreset.repairPercent,
        });
        if (encodeJobRef.current === job) installTransfer(next);
      } catch (cause) {
        if (encodeJobRef.current === job) {
          setTransfer(undefined);
          transferRef.current = undefined;
          setError(
            cause instanceof Error
              ? cause.message
              : "تعذّر تجهيز بثّ RaptorQ.",
          );
        }
      } finally {
        if (encodeJobRef.current === job) setProcessing(false);
      }
    },
    [installTransfer],
  );

  const buildOptical = useCallback(
    async (prepared: PreparedFileParts): Promise<PreparedOpticalFile> => {
      const activePassword = encryptEnabled ? password.trim() : "";
      const transmitted = activePassword
        ? await encryptPayload(prepared.compressedBytes, activePassword)
        : prepared.compressedBytes;
      return buildOpticalContainer(prepared.original, transmitted, {
        filename: prepared.file.name,
        mime: prepared.file.type || "application/octet-stream",
        compression: prepared.compressedMode,
      });
    },
    [encryptEnabled, password],
  );

  const prepareFile = useCallback(
    async (file: File) => {
      setError("");
      setPlaying(false);
      setActualFps(0);
      if (file.size > MAX_FILE_BYTES) {
        setError("اختر ملفاً أصغر من 512 ميجابايت لهذا الإصدار.");
        return;
      }
      setProcessing(true);
      try {
        const original = new Uint8Array(await file.arrayBuffer());
        const compressed = await compressForTransfer(original);
        const prepared: PreparedFile = {
          file,
          original,
          compressedBytes: compressed.bytes,
          compressedMode: compressed.mode,
          optical: await buildOptical({
            file,
            original,
            compressedBytes: compressed.bytes,
            compressedMode: compressed.mode,
          }),
        };
        setFileData(prepared);
        await encodePrepared(prepared, presetKey);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : "تعذّر تجهيز الملف.",
        );
        setProcessing(false);
      }
    },
    [buildOptical, encodePrepared, presetKey],
  );

  const changePreset = (nextKey: TransferPresetKey) => {
    setPresetKey(nextKey);
    setPlaying(false);
    setActualFps(0);
    if (fileData) void encodePrepared(fileData, nextKey);
  };

  const changeEncryption = (nextEnabled: boolean) => {
    setEncryptEnabled(nextEnabled);
    if (fileData && !nextEnabled) {
      // إيقاف التشفير: إعادة البناء بدون كلمة مرور.
      void buildOptical(fileData).then((optical) => {
        const nextPrepared = { ...fileData, optical };
        setFileData(nextPrepared);
        return encodePrepared(nextPrepared, presetKey);
      });
    }
  };

  const changePassword = (nextPassword: string) => {
    setPassword(nextPassword);
    if (fileData && encryptEnabled) {
      void buildOptical(fileData).then((optical) => {
        const nextPrepared = { ...fileData, optical };
        setFileData(nextPrepared);
        return encodePrepared(nextPrepared, presetKey);
      });
    }
  };

  const renderPacket = useCallback(
    async (
      target: OpticalTransfer,
      packetIndex: number,
      activePreset: (typeof TRANSFER_PRESETS)[TransferPresetKey],
      laneIndex = 0,
    ) => {
      const canvas = canvasRefs.current[laneIndex];
      if (!canvas) return;
      const { renderRawQrViaWorker } = await import("@/lib/qr-render-worker");
      const image = await renderRawQrViaWorker({
        packet: target.packets[packetIndex],
        version: activePreset.version,
        ecc: activePreset.ecc,
        scale: activePreset.renderScale,
      });
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("سطح الرسم غير متاح.");
      context.putImageData(image, 0, 0);
    },
    [],
  );

  useEffect(() => {
    if (!transfer || orderRef.current.length === 0) return;
    void Promise.all(
      Array.from({ length: preset.lanes }, (_, laneIndex) =>
        renderPacket(
          transfer,
          orderRef.current[laneIndex % orderRef.current.length],
          preset,
          laneIndex,
        ),
      ),
    ).catch(() => setError("تعذّر عرض معاينة QR."));
  }, [preset, renderPacket, transfer]);

  useEffect(() => {
    if (!playing || !transfer) return;
    let cancelled = false;
    let animationFrame = 0;
    const interval = 1000 / preset.fps;
    let nextFrameAt = performance.now();
    broadcastFrameTimesRef.current = [];

    const tick = async (now: number) => {
      if (now + 0.5 < nextFrameAt) {
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }
      const activeTransfer = transferRef.current;
      const order = orderRef.current;
      if (!activeTransfer || order.length === 0 || cancelled) return;
      const packetIndex = order[playedFramesRef.current % order.length];
      const laneIndex = playedFramesRef.current % preset.lanes;
      try {
        await renderPacket(activeTransfer, packetIndex, preset, laneIndex);
      } catch {
        setError("توقّف عرض QR بعد خطأ غير متوقع.");
        setPlaying(false);
        return;
      }
      if (cancelled) return;
      playedFramesRef.current += 1;
      const completedAt = performance.now();
      const frameTimes = broadcastFrameTimesRef.current;
      frameTimes.push(completedAt);
      while (
        frameTimes.length > 2 &&
        completedAt - frameTimes[0] > 2500
      ) {
        frameTimes.shift();
      }

      const uiInterval = Math.max(1, Math.round(preset.fps / 10));
      if (playedFramesRef.current % uiInterval === 0) {
        setPlayedFrames(playedFramesRef.current);
        if (frameTimes.length > 1) {
          setActualFps(
            ((frameTimes.length - 1) * 1000) /
              (frameTimes[frameTimes.length - 1] - frameTimes[0]),
          );
        }
      }

      nextFrameAt += interval;
      if (nextFrameAt < completedAt - interval) {
        nextFrameAt = completedAt + interval;
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [playing, preset, renderPacket, transfer]);

  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) void prepareFile(file);
  };

  const dropFile = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void prepareFile(file);
  };

  const scanUrl = useMemo(() => {
    if (typeof window === "undefined") return "/scan";
    return `${window.location.origin}/scan`;
  }, []);

  const copyScanLink = async () => {
    try {
      await navigator.clipboard.writeText(scanUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("فشل النسخ. افتح الموقع على الهاتف واختر «مسح».");
    }
  };

  const toggleFullscreen = async () => {
    if (!qrStageRef.current) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        setActualFps(0);
        setPlaying(true);
        await qrStageRef.current.requestFullscreen();
      }
    } catch {
      setPlaying(false);
      setError("ملء الشاشة غير متاح في هذا المتصفح. كبّر النافذة بدلاً من ذلك.");
    }
  };

  const orderLength = transfer?.packets.length ?? 0;
  const cycleFrame =
    orderLength > 0
      ? playedFrames === 0
        ? 0
        : ((playedFrames - 1) % orderLength) + 1
      : 0;
  const cycleNumber =
    orderLength > 0 && playedFrames > 0
      ? Math.floor((playedFrames - 1) / orderLength) + 1
      : 1;
  const cycleProgress = orderLength ? cycleFrame / orderLength : 0;
  const compressionPercent =
    transfer && transfer.meta.fileSize > 0
      ? Math.max(
          0,
          Math.round(
            (1 - transfer.meta.transmittedSize / transfer.meta.fileSize) * 100,
          ),
        )
      : 0;
  const nominalRate = preset.usefulBytesPerFrame * preset.fps;
  const passwordTooShort = encryptEnabled && password.trim().length < 4;

  return (
    <main>
      <section className="sender-hero">
        <div>
          <p className="eyebrow">نقل ملفات معزول عن الشبكة</p>
          <h1>انقل ملفاً<br />عبر الكاميرا.</h1>
        </div>
        <div className="hero-copy">
          <p>
            يبقى ملفك على أجهزتك. يضغطه QRFerry ثم يرسله عبر بثّ RaptorQ
            ثنائي متسامح مع الفقد — دون أي خادم في المنتصف.
          </p>
          <div className="trust-row">
            <span>محلي فقط</span>
            <span>Brotli-11 + gzip-9</span>
            <span>RaptorQ FEC</span>
          </div>
        </div>
      </section>

      <section className="sender-grid" aria-label="إنشاء نقل عبر QR">
        <div className="control-panel">
          <div className="step-heading">
            <span>01</span>
            <div>
              <h2>اختر ملفاً</h2>
              <p>الضغط والترميز يحدثان داخل هذا المتصفح.</p>
            </div>
          </div>

          <div
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={dropFile}
          >
            <input
              ref={inputRef}
              type="file"
              onChange={selectFile}
              aria-label="اختر ملفاً للنقل"
            />
            <button
              className="file-button"
              type="button"
              disabled={processing}
              onClick={() => inputRef.current?.click()}
            >
              <span aria-hidden="true">{processing ? "…" : "＋"}</span>
              {processing ? "جارٍ الضغط وبناء البث…" : "تصفّح الملفات"}
            </button>
            <p>أو أفلته هنا · حتى 512 ميجابايت</p>
          </div>

          {fileData ? (
            <div className="selected-file">
              <span className="file-glyph" aria-hidden="true">↗</span>
              <div>
                <strong>{fileData.optical.meta.filename}</strong>
                <span>
                  {formatBytes(fileData.optical.meta.fileSize)}
                  {fileData.optical.meta.compression !== "none"
                    ? ` → ${formatBytes(fileData.optical.meta.transmittedSize)} · ${compressionPercent}% أصغر · ${fileData.optical.meta.compression}`
                    : " · مضغوط مسبقاً"}
                  {fileData.optical.meta.encrypted ? (
                    <span className="encrypted-badge">🔒 مشفَّر</span>
                  ) : null}
                </span>
              </div>
              <button type="button" onClick={() => inputRef.current?.click()}>
                تغيير
              </button>
            </div>
          ) : null}

          <div className="encrypt-panel">
            <button
              type="button"
              className={`encrypt-toggle ${encryptEnabled ? "on" : ""}`}
              aria-pressed={encryptEnabled}
              onClick={() => changeEncryption(!encryptEnabled)}
            >
              <span className="lock-glyph" aria-hidden="true">
                {encryptEnabled ? "🔓" : "🔒"}
              </span>
              <span>
                {encryptEnabled
                  ? "الملف سيُنقل مشفَّراً"
                  : "تشفير الملف بكلمة مرور (اختياري)"}
              </span>
            </button>
            {encryptEnabled ? (
              <div className="encrypt-field">
                <label htmlFor="send-password">كلمة المرور</label>
                <input
                  id="send-password"
                  className="password-input"
                  type="password"
                  dir="ltr"
                  autoComplete="off"
                  value={password}
                  placeholder="أدخل كلمة مرور (4 أحرف على الأقل)"
                  onChange={(event) => changePassword(event.target.value)}
                />
                <p className="encrypt-hint">
                  عند التفعيل يُشفَّر المحتوى بـ AES-256، ولن يستطيع أي جهاز
                  صوّر الشاشة فكّه دون كلمة المرور. شاركها مع المستلم شفهياً
                  أو عبر قناة أخرى.
                </p>
              </div>
            ) : (
              <p className="encrypt-hint">
                تشفير اختياري يجعل التقاط الشاشة عديم الفائدة دون كلمة المرور.
              </p>
            )}
          </div>

          <div className="step-heading compact">
            <span>02</span>
            <div>
              <h2>اضبط قناة الإرسال</h2>
              <p>الأنماط المتينة تستخدم هدفاً واحداً؛ والمزدوجة تتبادل مسارين ثابتين.</p>
            </div>
          </div>

          <div className="preset-list" role="radiogroup" aria-label="ملف ضبط الإشارة">
            {(Object.keys(TRANSFER_PRESETS) as TransferPresetKey[]).map((key) => {
              const option = TRANSFER_PRESETS[key];
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={presetKey === key}
                  className={presetKey === key ? "selected" : ""}
                  key={key}
                  onClick={() => changePreset(key)}
                >
                  <span className="radio-dot" aria-hidden="true" />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  <b>
                    {option.lanes === 1
                      ? `${option.fps} fps`
                      : `${option.fps} رمز/ث · ${option.fps / option.lanes} fps للمسار`}
                    {" · "}
                    {formatRate(option.usefulBytesPerFrame * option.fps)}
                  </b>
                </button>
              );
            })}
          </div>

          {preset.fps >= 30 ? (
            <p className="channel-warning">
              {preset.lanes === 2
                ? "الوضع المزدوج: استخدم ملء الشاشة، أدر الهاتف أفقياً، واختر «مسار مزدوج» في الماسح."
                : "الوضع السريع: راقب معدلي الاستلام والمسح لدى المستقبِل. انزل درجة إذا توقف تزايد القراءات الفريدة."}
            </p>
          ) : null}

          {passwordTooShort ? (
            <p className="error-message" role="alert">
              كلمة المرور يجب ألا تقل عن 4 أحرف.
            </p>
          ) : null}

          {error ? <p className="error-message" role="alert">{error}</p> : null}
        </div>

        <div className="qr-panel">
          <div className="step-heading inverse">
            <span>03</span>
            <div>
              <h2>شغّل بثّ QR</h2>
              <p>
                {preset.lanes === 2
                  ? "أبقِ الكودَين الكاملين داخل إطار الهاتف الأفقي."
                  : "املأ إطار الهاتف بهذا الكود الكامل."}
              </p>
            </div>
          </div>

          <div
            ref={qrStageRef}
            className={`qr-stage ${transfer ? "ready" : ""} ${playing ? "playing" : ""} lanes-${preset.lanes}`}
          >
            {transfer ? (
              <div className={`qr-canvas-grid lanes-${preset.lanes}`}>
                {Array.from({ length: preset.lanes }, (_, laneIndex) => (
                  <canvas
                    key={laneIndex}
                    ref={(canvas) => {
                      canvasRefs.current[laneIndex] = canvas;
                    }}
                    aria-label={
                      preset.lanes === 1
                        ? "بثّ نقل ملفات RaptorQ متحرك"
                        : `بثّ نقل ملفات RaptorQ متحرك — المسار ${laneIndex + 1}`
                    }
                  />
                ))}
              </div>
            ) : (
              <div className="qr-placeholder" aria-hidden="true">
                <div className="finder top-left" />
                <div className="finder top-right" />
                <div className="finder bottom-left" />
                <span>
                  {processing
                    ? "جارٍ ترميز البث…"
                    : "سيظهر بثّ QR هنا"}
                </span>
              </div>
            )}
            <button
              className="fullscreen-button"
              type="button"
              onClick={toggleFullscreen}
              disabled={!transfer}
              aria-label="عرض الكود بملء الشاشة"
            >
              ⛶
            </button>
          </div>

          <div className="stream-status" aria-live="polite">
            <div>
              <span className={`pulse-dot ${playing ? "live" : ""}`} aria-hidden="true" />
              <strong>
                {playing
                  ? "جارٍ البث"
                  : transfer
                    ? "جاهز للبث"
                    : processing
                      ? "جارٍ الترميز"
                      : "بانتظار ملف"}
              </strong>
            </div>
            <span>
              {transfer
                ? `${estimateDuration(transfer, preset)} · معدل اسمي ${formatRate(nominalRate)}${
                    playing && actualFps > 0
                      ? ` · ${actualFps.toFixed(1)} fps معروض`
                      : ""
                  }`
                : "الكاميرا لا تحتاج إلى اتصال بالشبكة أبداً"}
            </span>
          </div>

          {transfer ? (
            <div className="broadcast-progress">
              <div>
                <strong>دورة RaptorQ {cycleNumber}</strong>
                <span>
                  إطار {cycleFrame.toLocaleString()} /{" "}
                  {orderLength.toLocaleString()} ·{" "}
                  {transfer.sourcePacketCount.toLocaleString()} مصدر +{" "}
                  {transfer.repairPacketIndices.length.toLocaleString()} إصلاح
                </span>
              </div>
              <div
                className="broadcast-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(cycleProgress * 100)}
              >
                <span style={{ width: `${cycleProgress * 100}%` }} />
              </div>
            </div>
          ) : null}

          <button
            className="primary-action"
            type="button"
            disabled={!transfer || processing || passwordTooShort}
            onClick={() => {
              if (!playing) setActualFps(0);
              setPlaying((current) => !current);
            }}
          >
            <span aria-hidden="true">{playing ? "Ⅱ" : "▶"}</span>
            {playing ? "أوقف البث مؤقتاً" : "ابدأ بثّ QR"}
          </button>

          <button className="link-action" type="button" onClick={copyScanLink}>
            <span aria-hidden="true">⌁</span>
            {copied ? "تم نسخ الرابط" : "انسخ رابط الماسح للموبايل"}
          </button>
        </div>
      </section>

      <section className="how-it-works">
        <p className="eyebrow">أقرب إلى الحد البصري</p>
        <div className="how-grid">
          <h2>بتّات أكثر فائدة.<br />في كل لقطة.</h2>
          <div className="feature">
            <span>01</span>
            <h3>اضغط أولاً</h3>
            <p>Brotli بجودة 11 يتسابق مع gzip بمستوى 9؛ لا يعبر الكاميرا إلا الناتج الأصغر حجماً.</p>
          </div>
          <div className="feature">
            <span>02</span>
            <h3>QR ثنائي خام</h3>
            <p>رموز ثنائية بلا توسعة Base45، مع هندسة تتبّع ثابتة يسهل على الكاميرا الإمساك بها.</p>
          </div>
          <div className="feature">
            <span>03</span>
            <h3>RaptorQ عبر الزمن</h3>
            <p>تتداخل رموز المصدر والإصلاح، فتتحول الضبابية والإطارات المفقودة إلى محوٍ غير ضار.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
