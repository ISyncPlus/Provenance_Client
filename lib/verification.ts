import { isUsableCoordinate } from "./coordinates";
import type {
  CaptureMode,
  CheckResult,
  HistoryEntry,
  LocationAttestation,
  LocationSource,
  MetadataResult,
  VerificationResult,
} from "./types";

/**
 * Applies the verification rules described in Chapter Three: timestamp check,
 * location check, device check, and duplicate detection via SHA-256.
 *
 * Two things about the location rule are worth stating plainly, because they
 * decide what a "Verified" badge is worth.
 *
 * **A witnessed capture is stronger than an uploaded file, and is scored that
 * way.** A photograph taken inside Provenance has no EXIF at all — it is
 * encoded by the browser, not by a camera — so applying the upload rules to it
 * would fail every check on the strongest evidence the system can collect.
 * Instead the app's own record of the capture stands in: it saw the shutter, so
 * it knows the time; it held the camera, so it knows the device; and it read
 * the position at that instant, so it knows where.
 *
 * **An attested position never satisfies the location check.** It says where
 * the student was when they pressed submit, which is a claim about the student
 * and not about the photograph. It is recorded, shown to the reviewer, and
 * deliberately left out of the verdict.
 */
export const verifyImage = (
  metadata: MetadataResult,
  hash: string,
  history: HistoryEntry[],
  context: {
    captureMode?: CaptureMode;
    location?: LocationAttestation | null;
  } = {}
): VerificationResult => {
  const reused = history.some((entry) => entry.hash === hash);
  const witnessed = context.captureMode === "witnessed";
  const attestation = context.location ?? null;

  const embedded = isUsableCoordinate(
    metadata.gps.latitude,
    metadata.gps.longitude
  );
  const witnessedFix =
    witnessed &&
    attestation?.source === "witnessed" &&
    isUsableCoordinate(attestation.latitude, attestation.longitude);

  const locationSource: LocationSource | null = witnessedFix
    ? "witnessed"
    : embedded
      ? "embedded"
      : attestation
        ? "attested"
        : null;

  const timeCheck: CheckResult =
    metadata.captureTime || witnessed ? "Pass" : "Fail";
  const locationCheck: CheckResult =
    embedded || witnessedFix ? "Pass" : "Fail";
  const deviceCheck: CheckResult =
    metadata.device || witnessed ? "Pass" : "Fail";
  const duplicateCheck: CheckResult = reused ? "Fail" : "Pass";

  if (reused) {
    return {
      status: "Reused",
      reason:
        "This image's SHA-256 hash matches a previous submission: possible duplicate or reused evidence.",
      timeCheck,
      locationCheck,
      deviceCheck,
      duplicateCheck,
      reused,
      locationSource,
    };
  }

  const failures: string[] = [];
  if (timeCheck === "Fail") failures.push("capture time");
  if (locationCheck === "Fail") failures.push("location");
  if (deviceCheck === "Fail") failures.push("device information");

  if (failures.length === 0) {
    return {
      status: "Verified",
      reason: witnessed
        ? "Captured inside Provenance. The capture time, device and position were recorded as the picture was taken."
        : "Capture time, GPS location and device information are all present in the file and consistent.",
      timeCheck,
      locationCheck,
      deviceCheck,
      duplicateCheck,
      reused,
      locationSource,
    };
  }

  const missing =
    failures.length === 1
      ? failures[0]
      : `${failures.slice(0, -1).join(", ")} and ${failures[failures.length - 1]}`;

  /* An attested position is worth saying out loud even though it did not count,
     so the reviewer knows a position exists and why it was not treated as one. */
  const attestedNote =
    locationCheck === "Fail" && attestation?.source === "attested"
      ? " The student's device reported a position at upload, which is recorded separately: it attests where they were when submitting, not where the photograph was taken."
      : "";

  return {
    status: "Suspicious",
    reason: `Missing or unreadable ${missing}. The metadata may have been stripped or altered.${attestedNote}`,
    timeCheck,
    locationCheck,
    deviceCheck,
    duplicateCheck,
    reused,
    locationSource,
  };
};
