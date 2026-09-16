"use client";

import { useCallback, useRef, useState } from "react";
import type { DragEvent } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Card from "../ui/Card";
import { Button } from "../ui/Button";
import StatusBadge from "../StatusBadge";
import CryptographicStream from "../ui/CryptographicStream";
import {
  Alert,
  Camera,
  Check,
  Clock,
  Copies,
  Doc,
  Pin,
  Upload,
} from "../ui/icons";
import { fade, springMove, springSnappy, stagger } from "../../lib/motion";
import { formatCoordinates } from "../../lib/format";
import { formatAccuracy, formatCoordinatePair } from "../../lib/coordinates";
import type { CheckResult, HistoryEntry, LocationSource } from "../../lib/types";

export type WorkspacePhase = "idle" | "working" | "result";

/**
 * What each tier of location evidence actually claims. The wording matters:
 * an attested position is a statement about the student, not the photograph,
 * and the interface must never let the two read as the same finding.
 */
const LOCATION_TIERS: Record<
  LocationSource,
  { label: string; claim: string; tone: "good" | "warn" }
> = {
  embedded: {
    label: "From the photograph",
    claim: "The file's own EXIF or XMP carried these coordinates.",
    tone: "good",
  },
  witnessed: {
    label: "Witnessed at capture",
    claim:
      "Provenance took this picture and read the position at the same instant.",
    tone: "good",
  },
  attested: {
    label: "Attested by the student",
    claim:
      "Where the student's device was at upload. It does not establish where the photograph was taken.",
    tone: "warn",
  },
};

type SubmitWorkspaceProps = {
  phase: WorkspacePhase;
  /** Full-resolution preview, held in memory only — never uploaded. */
  previewUrl: string | null;
  fileName: string | null;
  /** Narration of the current step, e.g. "Extracting EXIF metadata". */
  step: string | null;
  error: string | null;
  entry: HistoryEntry | null;
  /** Set when the server found this hash under a *different* student. */
  duplicateOfOtherUser: boolean;
  /**
   * The shown verdict came from this device because the server could not be
   * reached, so it is not filed and cannot know about duplicates.
   */
  offlineNotice: string | null;
  onFile: (file: File) => void;
  onReset: () => void;
  onReport: () => void;
  /** Opens the in-app camera — the one path where the app witnesses capture. */
  onCapture: () => void;
  /** Whether to read the device position when an uploaded file has none. */
  attachPosition: boolean;
  onAttachPositionChange: (next: boolean) => void;
};

const CHECKS: Array<{
  key: "timeCheck" | "locationCheck" | "deviceCheck" | "duplicateCheck";
  label: string;
  icon: typeof Clock;
  failHint: string;
}> = [
  {
    key: "timeCheck",
    label: "Capture time",
    icon: Clock,
    failHint: "No original timestamp in the file",
  },
  {
    key: "locationCheck",
    label: "GPS location",
    icon: Pin,
    failHint: "No usable coordinates recorded",
  },
  {
    key: "deviceCheck",
    label: "Device",
    icon: Camera,
    failHint: "No camera make or model recorded",
  },
  {
    key: "duplicateCheck",
    label: "Not a duplicate",
    icon: Copies,
    failHint: "This file has been submitted before",
  },
];

/** Named so the narration can be shown as a route through the pipeline rather
 *  than one anonymous line of status text. */
const PIPELINE = [
  "Reading the file",
  "Extracting EXIF metadata",
  "Resolving location",
  "Checking against the ledger",
];

function CheckRow({
  label,
  icon: Icon,
  result,
  hint,
  index,
}: {
  label: string;
  icon: typeof Clock;
  result: CheckResult;
  hint: string;
  index: number;
}) {
  const reduced = useReducedMotion();
  const passed = result === "Pass";

  return (
    <motion.li
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springMove, delay: stagger(index, 0.06) }}
      className="flex items-start gap-3 py-3"
    >
      <span
        className={`mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-sm ${
          passed ? "bg-good-wash text-good" : "bg-warn-wash text-warn"
        }`}
      >
        {passed ? (
          <Check size={12} strokeWidth={2.6} />
        ) : (
          <Alert size={12} strokeWidth={2.6} />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="t-footnote flex items-center gap-1.5 font-medium text-ink">
          <Icon size={13} className="shrink-0 text-ink-3" />
          {label}
        </span>
        {!passed ? (
          <span className="t-caption mt-0.5 block text-ink-2">{hint}</span>
        ) : null}
      </span>

      <span
        className={`t-mark shrink-0 pt-0.5 ${passed ? "text-good" : "text-warn"}`}
      >
        {passed ? "Pass" : "Fail"}
      </span>
    </motion.li>
  );
}

/**
 * The bench where a submission is examined.
 *
 * Three states share one surface, and the thumbnail travels between them with a
 * shared-element transition: the same photograph you dropped is the one being
 * scanned, and then the one attached to the verdict. Redrawing a new image at
 * each stage would break the thread the whole screen depends on.
 */
export default function SubmitWorkspace({
  phase,
  previewUrl,
  fileName,
  step,
  error,
  entry,
  duplicateOfOtherUser,
  offlineNotice,
  onFile,
  onReset,
  onReport,
  onCapture,
  attachPosition,
  onAttachPositionChange,
}: SubmitWorkspaceProps) {
  const reduced = useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Drag events fire per child element; a counter avoids the highlight
  // flickering as the pointer crosses the zone's own children.
  const dragDepth = useRef(0);

  const handleDrop = useCallback(
    (event: DragEvent<HTMLElement>) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onFile(file);
    },
    [onFile]
  );

  const verification = entry?.verification ?? null;
  const activeStep = step ? PIPELINE.indexOf(step) : -1;

  return (
    <Card
      bezel
      mark="Bench 01"
      title="Submit evidence"
      subtitle="Original camera photograph — JPEG or PNG, up to 25 MB"
      actions={
        phase === "result" ? (
          <Button size="sm" variant="quiet" onClick={onReset}>
            <Upload size={14} />
            New check
          </Button>
        ) : null
      }
    >
      <AnimatePresence mode="wait" initial={false}>
        {/* ------------------------------------------------------- idle */}
        {phase === "idle" ? (
          <motion.div
            key="idle"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={fade}
          >
            {/* The witnessed path leads, because it is the stronger claim: an
                uploaded file's metadata is whatever the file says, while a
                capture taken here is one the app actually observed. */}
            <button
              type="button"
              onClick={onCapture}
              className="group mb-4 flex min-h-12 sm:min-h-14 w-full items-center justify-between gap-3 rounded-full bg-accent py-2 pl-4 pr-2 sm:pl-6 text-accent-ink shadow-accent transition-transform duration-200 active:scale-[0.99]"
            >
              <span className="flex min-w-0 flex-col items-start">
                <span className="t-callout font-semibold">Capture now</span>
                <span className="t-mark text-[0.5625rem] opacity-75">
                  Strongest evidence
                </span>
              </span>
              <span className="flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full bg-black/15 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-105">
                <Camera size={18} />
              </span>
            </button>

            <div className="mb-4 flex items-center gap-3 sm:gap-4">
              <span className="h-px flex-1 bg-rule" />
              <span className="t-mark text-ink-3">or submit an existing file</span>
              <span className="h-px flex-1 bg-rule" />
            </div>

            <label
              onDragEnter={(event) => {
                event.preventDefault();
                dragDepth.current += 1;
                setDragging(true);
              }}
              onDragLeave={() => {
                dragDepth.current -= 1;
                if (dragDepth.current <= 0) setDragging(false);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleDrop}
              className={`group relative flex cursor-pointer flex-col items-center justify-center gap-3 sm:gap-4 overflow-hidden rounded-md border border-dashed px-4 py-6 sm:px-6 sm:py-14 text-center transition-colors duration-200 ${
                dragging
                  ? "border-accent bg-accent-wash"
                  : "border-line-strong hover:bg-well"
              }`}
            >
              {/* A specimen tray: graph paper, with registration marks at the
                  corners so the empty state still reads as a place where
                  something is meant to be laid down. */}
              <span
                aria-hidden
                className="grid-paper pointer-events-none absolute inset-0 opacity-60"
              />
              {[
                "left-3 top-3 border-l border-t",
                "right-3 top-3 border-r border-t",
                "left-3 bottom-3 border-b border-l",
                "right-3 bottom-3 border-b border-r",
              ].map((corner) => (
                <span
                  key={corner}
                  aria-hidden
                  className={`pointer-events-none absolute h-4 w-4 border-line-strong ${corner}`}
                />
              ))}

              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) onFile(file);
                }}
              />

              <motion.span
                animate={
                  dragging && !reduced
                    ? { scale: 1.1, y: -3 }
                    : { scale: 1, y: 0 }
                }
                transition={springSnappy}
                className="relative flex h-12 w-12 items-center justify-center rounded-md bg-accent text-accent-ink shadow-accent"
              >
                <Upload size={20} />
              </motion.span>

              <span className="relative">
                <span className="t-title-3 block text-ink">
                  {dragging ? "Release to read it" : "Drop a photo, or browse"}
                </span>
                <span className="t-footnote mx-auto mt-2 block max-w-xs text-pretty text-ink-2">
                  The file is read here, on this device. Only the resulting
                  record is filed — never the photograph.
                </span>
              </span>

              <span className="t-mark relative text-ink-3">
                JPEG · PNG · ≤ 25 MB
              </span>
            </label>

            {/* Asked for here rather than on arrival: a permission prompt that
                appears the moment a page loads is refused reflexively, and this
                one only means anything once there is a file to attach it to. */}
            <label className="mt-4 flex cursor-pointer items-start gap-3 border-t border-rule pt-4">
              <input
                type="checkbox"
                checked={attachPosition}
                onChange={(event) => onAttachPositionChange(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
              />
              <span className="min-w-0">
                <span className="t-footnote block font-medium text-ink">
                  Record where I am when I submit
                </span>
                <span className="t-caption mt-0.5 block text-pretty text-ink-2">
                  Used only when the file carries no location of its own. It is
                  filed as your attestation, and never as evidence about the
                  photograph.
                </span>
              </span>
            </label>

            <AnimatePresence initial={false}>
              {error ? (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={fade}
                  className="t-footnote mt-3 flex items-start gap-2 rounded-sm border-l-2 border-bad bg-bad-wash px-3.5 py-2.5 text-bad"
                >
                  <Alert size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
                  {error}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </motion.div>
        ) : null}

        {/* ---------------------------------------------------- working */}
        {phase === "working" ? (
          <motion.div
            key="working"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            transition={fade}
            className="flex flex-col gap-6 py-4 sm:flex-row sm:items-center sm:gap-8"
          >
            <motion.div
              layoutId="submission-preview"
              transition={springMove}
              className="relative mx-auto aspect-square w-28 shrink-0 overflow-hidden rounded-sm bg-well ring-1 ring-line sm:mx-0"
            >
              {previewUrl ? (
                <Image
                  src={previewUrl}
                  alt=""
                  fill
                  unoptimized
                  className="object-cover"
                />
              ) : null}
              {/* A sheen travelling over the thumbnail reads as "being read"
                  without pretending to know real progress. */}
              {!reduced ? (
                <motion.span
                  aria-hidden
                  initial={{ y: "-120%" }}
                  animate={{ y: "120%" }}
                  transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-x-0 h-1/2 bg-gradient-to-b from-transparent via-accent/40 to-transparent"
                />
              ) : null}
            </motion.div>

            {/* The pipeline, named. A single spinner tells you to wait; a route
                tells you what is happening and how much of it is left. */}
            <ol className="ruled min-w-0 flex-1" aria-live="polite">
              {PIPELINE.map((name, index) => {
                const done = activeStep > index;
                const current = activeStep === index;
                return (
                  <li key={name} className="flex items-center gap-3 py-2">
                    <span
                      className={`t-num w-5 shrink-0 text-[0.6875rem] ${
                        current ? "text-accent" : "text-ink-3"
                      }`}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span
                      className={`t-footnote flex-1 truncate ${
                        current
                          ? "font-semibold text-ink"
                          : done
                            ? "text-ink-2"
                            : "text-ink-3"
                      }`}
                    >
                      {name}
                    </span>
                    {done ? (
                      <Check size={13} strokeWidth={2.6} className="text-good" />
                    ) : current ? (
                      <span className="blink h-1.5 w-1.5 rounded-full bg-accent" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-line-strong" />
                    )}
                  </li>
                );
              })}
              <li className="pt-2">
                <p className="t-num truncate text-[0.6875rem] text-ink-3">
                  {fileName}
                </p>
              </li>
            </ol>
          </motion.div>
        ) : null}

        {/* ----------------------------------------------------- result */}
        {phase === "result" && entry && verification ? (
          <motion.div
            key="result"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={springMove}
            className="flex flex-col gap-6"
          >
            <div className="flex items-start gap-4">
              <motion.div
                layoutId="submission-preview"
                transition={springMove}
                className="relative h-20 w-20 shrink-0 overflow-hidden rounded-sm bg-well ring-1 ring-line"
              >
                {previewUrl ? (
                  <Image
                    src={previewUrl}
                    alt=""
                    fill
                    unoptimized
                    className="object-cover"
                  />
                ) : null}
              </motion.div>

              <div className="min-w-0 flex-1">
                <StatusBadge status={entry.status} size="md" />
                <p className="t-footnote mt-2.5 truncate font-semibold text-ink">
                  {entry.fileName}
                </p>
                <p className="t-caption mt-1 text-pretty text-ink-2">
                  {entry.reason}
                </p>
              </div>
            </div>

            {offlineNotice ? (
              <p className="t-footnote flex items-start gap-2 rounded-sm border-l-2 border-warn bg-warn-wash px-3.5 py-2.5 text-warn">
                <Alert size={14} className="mt-0.5 shrink-0" />
                {offlineNotice}
              </p>
            ) : null}

            {duplicateOfOtherUser ? (
              <p className="t-footnote flex items-start gap-2 rounded-sm border-l-2 border-bad bg-bad-wash px-3.5 py-2.5 text-bad">
                <Copies size={14} className="mt-0.5 shrink-0" />
                This exact file was already submitted by a different student.
                Your reviewer can see both records.
              </p>
            ) : null}

            <div>
              <p className="t-mark text-ink-3">Verification matrix</p>
              <ul className="ruled mt-1 border-t border-rule">
                {CHECKS.map((check, index) => (
                  <CheckRow
                    key={check.key}
                    index={index}
                    label={check.label}
                    icon={check.icon}
                    result={verification[check.key]}
                    hint={check.failHint}
                  />
                ))}
              </ul>
            </div>

            {/* Location evidence, named by tier. The whole point of separating
                these is that a reviewer can see at a glance whether the
                coordinates describe the photograph or the person who filed it. */}
            {(() => {
              const source = entry.verification?.locationSource ?? null;
              if (!source) return null;
              const tier = LOCATION_TIERS[source];
              const attested = entry.location;
              const coords =
                source === "embedded"
                  ? entry.metadata.gps.latitude != null &&
                    entry.metadata.gps.longitude != null
                    ? formatCoordinatePair(
                        entry.metadata.gps.latitude,
                        entry.metadata.gps.longitude
                      )
                    : null
                  : attested
                    ? formatCoordinatePair(attested.latitude, attested.longitude)
                    : null;
              const accuracy = formatAccuracy(attested?.accuracyMetres ?? null);

              return (
                <div
                  className={`rounded-sm border-l-2 px-3.5 py-3 ${
                    tier.tone === "good"
                      ? "border-good bg-good-wash"
                      : "border-warn bg-warn-wash"
                  }`}
                >
                  <p
                    className={`t-mark flex items-center gap-1.5 ${
                      tier.tone === "good" ? "text-good" : "text-warn"
                    }`}
                  >
                    <Pin size={12} />
                    {tier.label}
                  </p>
                  {coords ? (
                    <p className="t-num mt-1.5 text-[0.75rem] text-ink">
                      {coords}
                      {accuracy ? ` · ${accuracy}` : ""}
                    </p>
                  ) : null}
                  <p className="t-caption mt-1 text-pretty text-ink-2">
                    {tier.claim}
                  </p>
                </div>
              );
            })()}

            <div>
              <p className="t-mark text-ink-3">Extracted telemetry</p>
              <dl className="ruled mt-1 border-y border-rule">
                {[
                  ["Captured", entry.metadata.captureTime ?? "Not available"],
                  ["Device", entry.metadata.device ?? "Not available"],
                  [
                    "Location",
                    entry.metadata.locationName ??
                      formatCoordinates(entry.metadata.gps) ??
                      "Not available",
                  ],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-start justify-between gap-4 py-2.5"
                  >
                    <dt className="t-mark shrink-0 text-ink-3">{label}</dt>
                    <dd className="t-footnote min-w-0 break-words text-right text-ink">{value}</dd>
                  </div>
                ))}
                <div className="py-2.5">
                  <dt className="t-mark text-ink-3">SHA-256</dt>
                  <dd className="mt-1.5">
                    <CryptographicStream hash={entry.hash} animate={false} />
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={onReport} arrow>
                <Doc size={15} />
                Print certificate
              </Button>
              <Button variant="quiet" onClick={onReset}>
                <Upload size={15} />
                Check another
              </Button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}
