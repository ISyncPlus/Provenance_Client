"use client";

import { useState } from "react";
import DashboardHeader from "../../components/DashboardHeader";
import HistoryList from "../../components/HistoryList";
import PageShell from "../../components/PageShell";
import Card from "../../components/ui/Card";
import Field from "../../components/ui/Field";
import Reveal from "../../components/ui/Reveal";
import { Button } from "../../components/ui/Button";
import SubmitWorkspace from "../../components/dashboard/SubmitWorkspace";
import type { WorkspacePhase } from "../../components/dashboard/SubmitWorkspace";
import CaptureCamera from "../../components/dashboard/CaptureCamera";
import type { WitnessedCapture } from "../../components/dashboard/CaptureCamera";
import { Alert, Doc } from "../../components/ui/icons";
import { createThumbnail, readFileAsArrayBuffer, readFileAsDataUrl } from "../../lib/file";
import { hashArrayBuffer } from "../../lib/hash";
import { extractMetadata } from "../../lib/metadata";
import {
  buildEntryReportHtml,
  buildSummaryReportHtml,
  openPrintableReport,
} from "../../lib/report";
import Breadcrumbs from "../../components/ui/Breadcrumbs";
import UserAvatar from "../../components/UserAvatar";
import { ApiError, createSubmission } from "../../lib/api";
import { useRequireProfile } from "../../lib/useProfile";
import { useSubmissions } from "../../lib/useSubmissions";
import { verifyImage } from "../../lib/verification";
import { readPosition } from "../../lib/geolocation";
import { isUsableCoordinate } from "../../lib/coordinates";
import type {
  CaptureMode,
  HistoryEntry,
  LocationAttestation,
  MetadataResult,
} from "../../lib/types";

const getExtension = (name: string): string =>
  name.toLowerCase().match(/\.([a-z0-9]+)$/i)?.[1] ?? "";

const validateImageFile = (file: File): string | null => {
  if (file.size === 0) return "That file is empty.";
  if (file.size > 25 * 1024 * 1024)
    return "That file is larger than 25 MB. Use the original camera photo, not a video frame export.";

  const extension = getExtension(file.name);
  const isHeic =
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    extension === "heic" ||
    extension === "heif";
  if (isHeic)
    return "HEIC/HEIF files usually lose their EXIF data in browsers. Export the photo as JPEG and try again.";

  const isJpeg =
    file.type === "image/jpeg" || extension === "jpg" || extension === "jpeg";
  const isPng = file.type === "image/png" || extension === "png";
  if (!isJpeg && !isPng) return "Please choose a JPEG or PNG image.";

  return null;
};

/** Presents a witnessed instant the same way an EXIF timestamp is presented,
 *  so the record reads consistently whatever produced it. */
const formatWitnessedTime = (iso: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

/** How stale the position was when the shutter fired. A large drift is worth
 *  a reviewer's attention even on a witnessed capture. */
const driftBetween = (fixedAt: string, capturedAt: string): number | null => {
  const fix = new Date(fixedAt).getTime();
  const shot = new Date(capturedAt).getTime();
  if (!Number.isFinite(fix) || !Number.isFinite(shot)) return null;
  return Math.round(Math.abs(shot - fix) / 1000);
};

/** Turns a coordinate pair into a place name, or null if that is not possible. */
const reverseGeocode = async (
  latitude: number,
  longitude: number
): Promise<string | null> => {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("lat", String(latitude));
    url.searchParams.set("lon", String(longitude));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("accept-language", "en");

    const response = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { display_name?: string };
    return typeof data.display_name === "string" ? data.display_name : null;
  } catch {
    // Geocoding is a nicety; coordinates alone still satisfy the check.
    return null;
  }
};

/** Resolves a place name for coordinates that came from the photo's own EXIF. */
const attachLocationName = async (
  metadata: MetadataResult
): Promise<MetadataResult> => {
  const { latitude, longitude } = metadata.gps;
  if (!isUsableCoordinate(latitude, longitude)) return metadata;
  const name = await reverseGeocode(latitude as number, longitude as number);
  return name ? { ...metadata, locationName: name } : metadata;
};

export default function StudentDashboard() {
  const { profile, loading: profileLoading } = useRequireProfile("student");
  const { submissions, stats, initialLoading, error: listError, prepend } =
    useSubmissions({ take: 25 });

  const [phase, setPhase] = useState<WorkspacePhase>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [entry, setEntry] = useState<HistoryEntry | null>(null);
  const [duplicateOfOtherUser, setDuplicateOfOtherUser] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [attachPosition, setAttachPosition] = useState(true);

  const reset = () => {
    setPhase("idle");
    setPreviewUrl(null);
    setFileName(null);
    setStep(null);
    setError(null);
    setEntry(null);
    setDuplicateOfOtherUser(false);
    setOfflineNotice(null);
  };

  /**
   * A picture taken inside Provenance. The file, the instant and the position
   * are already bound together by the camera component, so the only thing left
   * is to file them as one record.
   */
  const handleCapture = (capture: WitnessedCapture) => {
    setCameraOpen(false);
    void handleFile(capture.file, {
      mode: "witnessed",
      capture,
    });
  };

  type Provenance =
    | { mode: "uploaded" }
    | { mode: "witnessed"; capture: WitnessedCapture };

  const handleFile = async (
    file: File,
    provenance: Provenance = { mode: "uploaded" }
  ) => {
    const witnessed = provenance.mode === "witnessed";
    const captureMode: CaptureMode = witnessed ? "witnessed" : "uploaded";

    /* A witnessed frame is encoded by this browser, so the format rules written
       for camera files (HEIC advice, 25MB ceilings) have nothing to say about
       it — and its own capture path already guarantees a JPEG. */
    const problem = witnessed ? null : validateImageFile(file);
    if (problem) {
      setError(problem);
      setPhase("idle");
      return;
    }

    setError(null);
    setEntry(null);
    setDuplicateOfOtherUser(false);
    setOfflineNotice(null);
    setFileName(file.name);
    setPhase("working");

    try {
      setStep("Reading the file");
      const [buffer, dataUrl] = await Promise.all([
        readFileAsArrayBuffer(file),
        readFileAsDataUrl(file),
      ]);
      setPreviewUrl(dataUrl);

      setStep("Extracting EXIF metadata");
      const [hash, extracted] = await Promise.all([
        hashArrayBuffer(buffer),
        extractMetadata(buffer),
      ]);

      /*
       * A witnessed capture carries no EXIF — the browser encoded it, not a
       * camera — so the app's own record of the moment stands in its place.
       * These values are not presented as file metadata anywhere; the record's
       * capture mode says where they came from.
       */
      let metadata: MetadataResult = witnessed
        ? {
            ...extracted,
            captureTime: formatWitnessedTime(provenance.capture.capturedAt),
            device: provenance.capture.cameraLabel
              ? `In-app camera · ${provenance.capture.cameraLabel}`
              : "In-app camera",
          }
        : extracted;

      setStep("Resolving location");
      metadata = await attachLocationName(metadata);

      /*
       * Where the position comes from, and what it is allowed to claim.
       *
       * A witnessed fix was read as the shutter fired, so it describes the
       * photograph. An attested fix is read now, at upload, and describes only
       * the student — it is collected when the file itself has no coordinates,
       * and `verifyImage` refuses to let it satisfy the location check.
       */
      let attestation: LocationAttestation | null = null;

      if (witnessed && provenance.capture.fix) {
        const { fix, capturedAt } = provenance.capture;
        attestation = {
          ...fix,
          source: "witnessed",
          driftSeconds: driftBetween(fix.fixedAt, capturedAt),
          locationName: null,
        };
      } else if (
        !witnessed &&
        attachPosition &&
        !isUsableCoordinate(metadata.gps.latitude, metadata.gps.longitude)
      ) {
        setStep("Reading your position");
        const outcome = await readPosition();
        if (outcome.ok) {
          attestation = {
            ...outcome.fix,
            source: "attested",
            driftSeconds: null,
            locationName: null,
          };
        }
      }

      if (attestation) {
        const name = await reverseGeocode(
          attestation.latitude,
          attestation.longitude
        );
        if (name) attestation = { ...attestation, locationName: name };
        /* A witnessed fix *is* the photograph's location, so it may name the
           record's place. An attested one may not: naming it would put the
           student's upload location in the field a reviewer reads as the
           photograph's. */
        if (attestation.source === "witnessed" && name) {
          metadata = { ...metadata, locationName: name };
        }
      }

      setStep("Checking against the ledger");
      const thumbnail = await createThumbnail(dataUrl);

      /*
       * A provisional verdict computed here, so a result still appears if the
       * server is unreachable (ARCHITECTURE.md, Decision 5). It is deliberately
       * given no history: this device cannot see other students' hashes, so it
       * must never claim a file is unique — only the server can settle that.
       */
      const local = verifyImage(metadata, hash, [], {
        captureMode,
        location: attestation,
      });
      const provisional: HistoryEntry = {
        id: `local-${hash.slice(0, 12)}`,
        hash,
        fileName: file.name,
        previewUrl: thumbnail,
        checkedAt: new Date().toISOString(),
        status: local.status,
        reason: local.reason,
        metadata,
        verification: local,
        captureMode,
        location: attestation,
        submittedBy: {
          name: profile?.name ?? "",
          identifier: profile?.identifier ?? "",
        },
      };

      try {
        // The server is the authority: it alone sees every student's hashes.
        const result = await createSubmission({
          hash,
          fileName: file.name,
          thumbnailUrl: thumbnail,
          metadata: {
            captureTime: metadata.captureTime,
            latitude: metadata.gps.latitude,
            longitude: metadata.gps.longitude,
            locationName: metadata.locationName,
            device: metadata.device,
            gpsTagsPresent: metadata.gpsTagsPresent,
          },
          captureMode,
          location: attestation,
        });

        /* The deployed API may predate these fields and drop them. The record
           the student sees and prints should still be whole, so the evidence
           this device collected is merged back over the server's copy. */
        const filed: HistoryEntry = {
          ...result.submission,
          captureMode: result.submission.captureMode ?? captureMode,
          location: result.submission.location ?? attestation,
          verification: result.submission.verification ?? local,
        };

        setEntry(filed);
        setDuplicateOfOtherUser(result.duplicateOfOtherUser);
        prepend(filed);
      } catch (caught) {
        if (!(caught instanceof ApiError)) throw caught;

        // Show the local reading rather than nothing, and say plainly that it
        // is unfiled and cannot account for duplicates.
        setEntry(provisional);
        setOfflineNotice(
          `${caught.message} This result was produced on your device, has not been filed, and cannot check for duplicates.`
        );
      }

      setPhase("result");
    } catch (caught) {
      console.error(caught);
      setError("Could not read that image. Please try another file.");
      setPhase("idle");
    } finally {
      setStep(null);
    }
  };

  if (profileLoading || !profile) {
    return (
      <PageShell stamp="Student Inspector">
        <Field pad="none" className="pt-12">
          <div className="flex flex-col gap-5">
            <div className="shimmer h-3 w-40 rounded-sm bg-well" />
            <div className="shimmer h-10 w-80 max-w-full rounded-sm bg-well" />
            <div className="rule-quad mt-6 border-y border-rule">
              {[0, 1, 2, 3].map((index) => (
                <div key={index}>
                  <div className="shimmer h-2.5 w-20 rounded-sm bg-well" />
                  <div className="shimmer mt-4 h-8 w-14 rounded-sm bg-well" />
                </div>
              ))}
            </div>
            <div className="mx-auto mt-4 grid w-full max-w-md gap-6 sm:max-w-xl lg:max-w-none lg:grid-cols-12">
              <div className="shimmer h-96 rounded-lg bg-well lg:col-span-7" />
              <div className="shimmer h-96 rounded-lg bg-well lg:col-span-5" />
            </div>
          </div>
        </Field>
      </PageShell>
    );
  }

  const filedToday = submissions.filter(
    (item) =>
      new Date(item.checkedAt).toDateString() === new Date().toDateString()
  ).length;

  return (
    <PageShell session={profile} stamp="Student Inspector · Case File">
      <Field pad="none" className="pt-6">
        <Breadcrumbs
          items={[{ label: "Home", href: "/" }, { label: "Student Inspector" }]}
        />
      </Field>

      <DashboardHeader
        stats={stats}
        eyebrow="Student · Inspector"
        title={`Welcome back, ${profile.name.split(" ")[0]}`}
        subtitle="Submit an original practical, laboratory, fieldwork or SIWES photograph. It is read here on your device; only the resulting record is filed."
        slip={
          /* The reader's own credentials, set as a slip clipped to the file —
             the same object language as the specimen card on the landing page. */
          <div className="w-full max-w-xs overflow-hidden rounded-lg border border-line bg-surface shadow-card">
            <div className="flex items-center justify-between gap-3 border-b border-rule bg-surface-2/60 px-4 py-2.5">
              <span className="t-mark text-ink-3">Registered</span>
              <span className="t-mark text-accent-deep">Student</span>
            </div>
            <div className="flex items-center gap-3 border-b border-rule px-4 py-3 bg-surface">
              <UserAvatar
                name={profile.name}
                image={profile.image}
                size="lg"
              />
              <div className="min-w-0 flex-1">
                <span className="t-footnote block truncate font-semibold text-ink">
                  {profile.name}
                </span>
                <span className="t-caption block truncate text-ink-3">
                  {profile.email}
                </span>
              </div>
            </div>
            <dl className="ruled px-4">
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="t-mark text-ink-3">Reg. no</dt>
                <dd className="t-num text-[0.8125rem] text-ink">
                  {profile.identifier || "-"}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2.5">
                <dt className="t-mark text-ink-3">Filed today</dt>
                <dd className="t-num text-[0.8125rem] text-ink">
                  {String(filedToday).padStart(2, "0")}
                </dd>
              </div>
            </dl>
          </div>
        }
      />

      <Field pad="md" className="px-2 sm:px-4 lg:px-0">
        {/* Deliberately off-balance: the bench takes the larger share, because
            checking a photograph is the task and the history is the reference
            beside it. On mobile, constrain to a clean, comfortable reading measure
            so the cards never feel blown out or edge-to-edge. */}
        <div className="mx-auto grid w-full max-w-md gap-6 sm:max-w-xl lg:max-w-none lg:grid-cols-12 lg:gap-8">
          <Reveal index={2} mode="scroll" className="w-full lg:col-span-7">
            <SubmitWorkspace
              phase={phase}
              previewUrl={previewUrl}
              fileName={fileName}
              step={step}
              error={error}
              entry={entry}
              duplicateOfOtherUser={duplicateOfOtherUser}
              offlineNotice={offlineNotice}
              onFile={(file) => void handleFile(file)}
              onCapture={() => setCameraOpen(true)}
              attachPosition={attachPosition}
              onAttachPositionChange={setAttachPosition}
              onReset={reset}
              onReport={() => entry && openPrintableReport(buildEntryReportHtml(entry))}
            />
          </Reveal>

          <Reveal index={3} mode="scroll" className="w-full lg:col-span-5">
            <Card
              mark="File 02"
              title="Your submissions"
              subtitle={(stats?.total ?? 0) === 1 ? "1 record" : `${stats?.total ?? 0} records`}
              flush
              actions={
                submissions.length > 0 ? (
                  <Button
                    size="sm"
                    variant="quiet"
                    onClick={() =>
                      openPrintableReport(buildSummaryReportHtml(submissions))
                    }
                  >
                    <Doc size={14} />
                    Summary
                  </Button>
                ) : null
              }
              /* The capped, independently-scrolling body is a desktop
                 affordance: it keeps the list beside the bench instead of
                 running past it. On a phone the two are stacked, so a nested
                 scroller inside a scrolling page just traps the gesture and
                 hides records behind an edge with no visible scrollbar — the
                 list simply runs its full length there. */
              bodyClassName="px-3 py-3 lg:max-h-[34rem] lg:overflow-y-auto"
            >
              {listError && submissions.length === 0 ? (
                <p className="t-footnote flex items-start gap-2 rounded-sm border-l-2 border-bad bg-bad-wash px-3.5 py-2.5 text-bad">
                  <Alert size={14} className="mt-0.5 shrink-0" />
                  {listError}
                </p>
              ) : initialLoading && submissions.length === 0 ? (
                <div className="ruled">
                  {[0, 1, 2, 3].map((index) => (
                    <div key={index} className="flex items-center gap-3.5 py-3">
                      <div className="shimmer h-11 w-11 shrink-0 rounded-sm bg-well" />
                      <div className="flex-1">
                        <div className="shimmer h-3 w-2/3 rounded-sm bg-well" />
                        <div className="shimmer mt-2 h-2.5 w-1/2 rounded-sm bg-well" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {listError ? (
                    <p className="t-caption text-ink-3 flex items-center gap-1.5 px-1">
                      <Alert size={12} className="text-warn shrink-0" />
                      Showing offline cached records
                    </p>
                  ) : null}
                  <HistoryList
                    entries={submissions}
                    onEntryReport={(item) =>
                      openPrintableReport(buildEntryReportHtml(item))
                    }
                    emptyMessage="Nothing checked yet. Records appear here as you verify coursework photographs."
                  />
                </div>
              )}
            </Card>
          </Reveal>
        </div>
      </Field>

      <CaptureCamera
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleCapture}
      />
    </PageShell>
  );
}
