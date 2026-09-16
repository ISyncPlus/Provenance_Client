"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Alert, Camera, Check, Close, Pin } from "../ui/icons";
import { formatAccuracy } from "../../lib/coordinates";
import { readPosition } from "../../lib/geolocation";
import { fade, springMove } from "../../lib/motion";
import type { LocationFix } from "../../lib/types";

export type WitnessedCapture = {
  file: File;
  /** The position as it stood when the shutter fired. */
  fix: LocationFix | null;
  /** Why there is no fix, when there is none. */
  fixNote: string | null;
  /** The camera the browser actually opened, e.g. "Back Dual Wide Camera". */
  cameraLabel: string | null;
  /** When the frame was taken, by this device's clock. */
  capturedAt: string;
};

type CaptureCameraProps = {
  open: boolean;
  onClose: () => void;
  onCapture: (capture: WitnessedCapture) => void;
};

type CameraError = "denied" | "missing" | "busy" | "insecure" | "failed";

const CAMERA_MESSAGES: Record<CameraError, string> = {
  denied:
    "Camera permission was declined. Allow it in your browser's site settings, then try again.",
  missing: "No camera was found on this device.",
  busy: "The camera is already in use by another app.",
  insecure:
    "The camera is only available over HTTPS. Open Provenance on its secure address.",
  failed: "The camera could not be started.",
};

/** A fix older than this is re-taken before the frame is accepted. */
const FIX_STALE_MS = 30_000;

/**
 * Capture inside Provenance, with the position read as the shutter fires.
 *
 * This is the only path where the system observes the evidence being made
 * rather than being told about it afterwards. An uploaded file's EXIF is
 * whatever the file says — coordinates can be written into a JPEG in a few
 * lines of script — so a photograph that Provenance took itself, with the
 * device position read at the same instant, is a materially different claim.
 *
 * The frame is drawn at the camera track's real resolution rather than the
 * preview's, so the record is not a downscale of what the student saw.
 */
export default function CaptureCamera({
  open,
  onClose,
  onCapture,
}: CaptureCameraProps) {
  const reduced = useReducedMotion();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const watchRef = useRef<number | null>(null);
  const latestFix = useRef<{ fix: LocationFix; at: number } | null>(null);

  const [cameraError, setCameraError] = useState<CameraError | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState<LocationFix | null>(null);
  const [fixNote, setFixNote] = useState<string | null>(null);
  const [cameraLabel, setCameraLabel] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (watchRef.current != null && typeof navigator !== "undefined") {
      navigator.geolocation?.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    setReady(false);
  }, []);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    const start = async () => {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError(window.isSecureContext ? "failed" : "insecure");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
          audio: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        setCameraLabel(stream.getVideoTracks()[0]?.label || null);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setReady(true);
        setCameraError(null);
      } catch (error) {
        if (cancelled) return;
        const name = (error as DOMException)?.name;
        setCameraError(
          name === "NotAllowedError" || name === "SecurityError"
            ? "denied"
            : name === "NotFoundError" || name === "OverconstrainedError"
              ? "missing"
              : name === "NotReadableError"
                ? "busy"
                : "failed"
        );
      }
    };

    void start();

    /* A live watch keeps a fresh fix ready, so pressing the shutter does not
       wait on a cold GPS acquisition. */
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      watchRef.current = navigator.geolocation.watchPosition(
        (position) => {
          const next: LocationFix = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracyMetres: Number.isFinite(position.coords.accuracy)
              ? position.coords.accuracy
              : null,
            fixedAt: new Date(position.timestamp).toISOString(),
          };
          latestFix.current = { fix: next, at: Date.now() };
          setFix(next);
          setFixNote(null);
        },
        (error) => {
          setFixNote(
            error.code === error.PERMISSION_DENIED
              ? "Location declined — the capture will be filed without a position."
              : "No position yet. This is common indoors."
          );
        },
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
      );
    }

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, stop]);

  /* The camera holds hardware; it must not keep running behind a closed sheet. */
  useEffect(() => {
    if (!open) stop();
  }, [open, stop]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  const shutter = async () => {
    const video = videoRef.current;
    if (!video || !ready || busy) return;
    setBusy(true);

    try {
      const width = video.videoWidth;
      const height = video.videoHeight;
      if (!width || !height) return;

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);

      const capturedAt = new Date().toISOString();

      /* Use the live fix if it is fresh; otherwise take one now rather than
         attaching a position that may predate the student walking here. */
      let chosen = latestFix.current;
      let note: string | null = fixNote;
      if (!chosen || Date.now() - chosen.at > FIX_STALE_MS) {
        const outcome = await readPosition({ timeoutMs: 8000 });
        if (outcome.ok) {
          chosen = { fix: outcome.fix, at: Date.now() };
          note = null;
        } else {
          chosen = null;
          note = outcome.message;
        }
      }

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((value) => resolve(value), "image/jpeg", 0.92)
      );
      if (!blob) return;

      const stamp = capturedAt.replace(/[:.]/g, "-");
      const file = new File([blob], `provenance-capture-${stamp}.jpg`, {
        type: "image/jpeg",
      });

      onCapture({
        file,
        fix: chosen?.fix ?? null,
        fixNote: chosen ? null : note,
        cameraLabel,
        capturedAt,
      });
      stop();
    } finally {
      setBusy(false);
    }
  };

  const accuracy = formatAccuracy(fix?.accuracyMetres ?? null);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade}
          role="dialog"
          aria-modal="true"
          aria-label="Capture a photograph"
          data-field="ink"
          className="fixed inset-0 z-60 flex flex-col"
        >
          {/* Chrome */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-rule px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <span className="t-mark text-ink-2">Witnessed capture</span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close the camera"
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink transition-colors hover:bg-well"
            >
              <Close size={17} />
            </button>
          </div>

          {/* Viewfinder */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black">
            <video
              ref={videoRef}
              playsInline
              muted
              className="h-full w-full object-contain"
            />

            {/* Registration marks, so the frame reads as an instrument. */}
            {ready ? (
              <>
                {[
                  "left-4 top-4 border-l border-t",
                  "right-4 top-4 border-r border-t",
                  "left-4 bottom-4 border-b border-l",
                  "right-4 bottom-4 border-b border-r",
                ].map((corner) => (
                  <span
                    key={corner}
                    aria-hidden
                    className={`pointer-events-none absolute h-6 w-6 border-white/50 ${corner}`}
                  />
                ))}
              </>
            ) : null}

            {cameraError ? (
              <div className="absolute inset-0 flex items-center justify-center p-8">
                <div className="max-w-sm text-center">
                  <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-md bg-bad-wash text-bad">
                    <Alert size={20} />
                  </span>
                  <p className="t-callout mt-4 text-pretty text-ink">
                    {CAMERA_MESSAGES[cameraError]}
                  </p>
                </div>
              </div>
            ) : !ready ? (
              <p className="t-mark absolute text-ink-3">Starting the camera…</p>
            ) : null}
          </div>

          {/* Position read-out and shutter */}
          <div className="shrink-0 border-t border-rule px-4 pt-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-[max(2rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto flex w-full max-w-md flex-col gap-4">
              <div className="flex items-start gap-3 sm:items-center sm:justify-between">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      fix ? "bg-good-wash text-good" : "bg-well text-ink-3"
                    }`}
                  >
                    {fix ? <Check size={15} strokeWidth={2.6} /> : <Pin size={15} />}
                  </span>
                  <span className="min-w-0">
                    <span className="t-mark block text-ink-2">
                      {fix ? "Position locked" : "Locating"}
                    </span>
                    <span className="t-num block wrap-break-word text-[0.6875rem] text-ink-3">
                      {fix
                        ? `${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)}${
                            accuracy ? ` · ${accuracy}` : ""
                          }`
                        : (fixNote ?? "Waiting for the device")}
                    </span>
                  </span>
                </span>

                {cameraLabel ? (
                  <span className="t-mark max-w-[40%] shrink-0 text-right text-ink-3">
                    {cameraLabel}
                  </span>
                ) : null}
              </div>

              <motion.button
                type="button"
                onClick={() => void shutter()}
                disabled={!ready || busy}
                whileTap={reduced ? { opacity: 0.8 } : { scale: 0.96 }}
                transition={springMove}
                className="flex min-h-14 w-full items-center justify-center gap-2.5 rounded-full bg-accent text-accent-ink shadow-accent transition-opacity disabled:opacity-40"
              >
                <Camera size={18} />
                <span className="t-callout font-semibold">
                  {busy ? "Recording…" : "Capture"}
                </span>
              </motion.button>

              <p className="t-caption text-pretty text-center text-ink-3">
                The photograph, the moment and the position are recorded
                together. Nothing is uploaded — only the resulting record.
              </p>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
