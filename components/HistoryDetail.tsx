import Image from "next/image";
import StatusBadge from "./StatusBadge";
import CryptographicStream from "./ui/CryptographicStream";
import { Button } from "./ui/Button";
import { Alert, Camera, Check, Clock, Copies, Doc, Pin, User } from "./ui/icons";
import { formatCoordinates, formatDateTime } from "../lib/format";
import { formatAccuracy, formatCoordinatePair } from "../lib/coordinates";
import type { HistoryEntry, LocationSource } from "../lib/types";

type HistoryDetailProps = {
  entry: HistoryEntry;
  onReport: () => void;
};

const CHECKS: Array<{
  key: "timeCheck" | "locationCheck" | "deviceCheck" | "duplicateCheck";
  label: string;
}> = [
  { key: "timeCheck", label: "Capture time" },
  { key: "locationCheck", label: "Location" },
  { key: "deviceCheck", label: "Device" },
  { key: "duplicateCheck", label: "Not a duplicate" },
];

/**
 * How each tier of location evidence is named to a reviewer, and what it is
 * allowed to claim. A reviewer deciding whether a student was where they say
 * they were needs the distinction stated, not implied by placement.
 */
const LOCATION_TIERS: Record<
  LocationSource,
  { label: string; claim: string; tone: "good" | "warn" }
> = {
  embedded: {
    label: "From the photograph",
    claim: "Read from the file's own EXIF or XMP metadata.",
    tone: "good",
  },
  witnessed: {
    label: "Witnessed at capture",
    claim:
      "Provenance took this photograph and read the position at the same instant.",
    tone: "good",
  },
  attested: {
    label: "Attested by the student",
    claim:
      "Reported by the student's device at upload. It does not establish where the photograph was taken, and was not counted towards the location check.",
    tone: "warn",
  },
};

/** One line of the record: what it is on the left, what it says on the right. */
function Reading({
  icon: Glyph,
  label,
  value,
}: {
  icon: typeof Clock;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-start gap-3 py-3">
      <Glyph size={15} className="mt-0.5 shrink-0 text-ink-3" />
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-5 gap-y-1">
        <span className="t-mark shrink-0 text-ink-3">{label}</span>
        <span
          className={`t-footnote min-w-0 text-right wrap-break-word ${
            value ? "font-medium text-ink" : "text-ink-3"
          }`}
        >
          {value ?? "Not available"}
        </span>
      </div>
    </div>
  );
}

export default function HistoryDetail({ entry, onReport }: HistoryDetailProps) {
  const coordinates = formatCoordinates(entry.metadata.gps);

  return (
    <div className="flex flex-col gap-7">
      {entry.previewUrl ? (
        <div className="relative aspect-[16/10] w-full overflow-hidden rounded-md bg-well ring-1 ring-line">
          <Image
            src={entry.previewUrl}
            alt={entry.fileName}
            fill
            unoptimized
            className="object-cover"
          />
          <span className="absolute bottom-2 left-2 rounded-sm bg-black/55 px-2 py-1 backdrop-blur-sm">
            <span className="t-mark text-[0.5625rem] text-white">Thumbnail · ≤96px</span>
          </span>
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5">
        <StatusBadge status={entry.status} size="md" />
        <p className="t-callout text-pretty text-ink-2">{entry.reason}</p>
      </div>

      {(() => {
        const source = entry.verification?.locationSource ?? null;
        if (!source) return null;
        const tier = LOCATION_TIERS[source];
        const attested = entry.location ?? null;
        const coords =
          source === "embedded" || !attested
            ? entry.metadata.gps.latitude != null &&
              entry.metadata.gps.longitude != null
              ? formatCoordinatePair(
                  entry.metadata.gps.latitude,
                  entry.metadata.gps.longitude
                )
              : null
            : formatCoordinatePair(attested.latitude, attested.longitude);
        const accuracy = formatAccuracy(attested?.accuracyMetres ?? null);

        return (
          <div>
            <p className="t-mark text-ink-3">Location evidence</p>
            <div
              className={`mt-2 rounded-sm border-l-2 px-3.5 py-3 ${
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
              {attested?.locationName ? (
                <p className="t-caption mt-1 text-ink-2">
                  {attested.locationName}
                </p>
              ) : null}
              <p className="t-caption mt-1.5 text-pretty text-ink-2">
                {tier.claim}
              </p>
              {attested?.driftSeconds != null ? (
                <p className="t-num mt-1.5 text-[0.6875rem] text-ink-3">
                  fix taken {attested.driftSeconds}s before the shutter
                </p>
              ) : null}
            </div>
          </div>
        );
      })()}

      <div>
        <p className="t-mark text-ink-3">Verification matrix</p>
        <ul className="ruled mt-1 border-y border-rule">
          {CHECKS.map(({ key, label }) => {
            const passed = entry.verification?.[key] === "Pass";
            return (
              <li key={key} className="flex items-center gap-3 py-2.5">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm ${
                    passed ? "bg-good-wash text-good" : "bg-bad-wash text-bad"
                  }`}
                >
                  {passed ? (
                    <Check size={12} strokeWidth={2.6} />
                  ) : (
                    <Alert size={12} strokeWidth={2.4} />
                  )}
                </span>
                <span className="t-footnote min-w-0 flex-1 truncate text-ink">
                  {label}
                </span>
                <span
                  className={`t-mark shrink-0 ${passed ? "text-good" : "text-bad"}`}
                >
                  {passed ? "Pass" : "Fail"}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <p className="t-mark text-ink-3">Record</p>
        <div className="ruled mt-1 border-y border-rule">
          <Reading
            icon={Clock}
            label="Captured"
            value={entry.metadata.captureTime}
          />
          <Reading
            icon={Pin}
            label="Location"
            value={entry.metadata.locationName ?? coordinates}
          />
          {entry.metadata.locationName && coordinates ? (
            <Reading icon={Pin} label="Coordinates" value={coordinates} />
          ) : null}
          <Reading icon={Camera} label="Device" value={entry.metadata.device} />
          <Reading
            icon={User}
            label="Submitted by"
            value={
              entry.submittedBy
                ? `${entry.submittedBy.name} · ${entry.submittedBy.identifier}`
                : null
            }
          />
          <Reading
            icon={Clock}
            label="Filed"
            value={formatDateTime(entry.checkedAt)}
          />
          <Reading
            icon={Camera}
            label="Origin"
            value={
              entry.captureMode === "witnessed"
                ? "Captured inside Provenance"
                : "Uploaded file"
            }
          />
          <div className="flex items-start gap-3 py-3">
            <Copies size={15} className="mt-0.5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <p className="t-mark text-ink-3">SHA-256</p>
              <div className="mt-1.5">
                <CryptographicStream hash={entry.hash} animate={false} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <Button variant="primary" onClick={onReport} className="w-full" arrow>
        <Doc size={16} />
        Open printable report
      </Button>
    </div>
  );
}
