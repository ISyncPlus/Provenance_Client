"use client";

import { API_URL } from "./auth-client";
import type {
  CaptureMode,
  HistoryEntry,
  LocationAttestation,
  VerificationStatus,
} from "./types";

/** An API failure carrying the server's message, so the UI can show it verbatim. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, message: string, code = "error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type ErrorBody = {
  error?: { code?: string; message?: string; details?: unknown };
};

const request = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  let response: Response;

  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      // Session travels as a cookie from another origin.
      credentials: "include",
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    // A dead server should say so plainly rather than surfacing "Failed to
    // fetch", which reads as a bug in the page.
    throw new ApiError(
      0,
      "Cannot reach the Provenance server. Check that it is running and try again.",
      "network_error"
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const isJson = response.headers
    .get("content-type")
    ?.includes("application/json");
  const body = isJson ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    const parsed = body as ErrorBody | null;
    throw new ApiError(
      response.status,
      parsed?.error?.message ?? `Request failed (${response.status})`,
      parsed?.error?.code ?? "error"
    );
  }

  return body as T;
};

// ------------------------------------------------------------------ Profile

export type Profile = {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "student" | "lecturer";
  identifier: string | null;
  onboarded: boolean;
};

export const fetchProfile = () =>
  request<{ user: Profile }>("/api/me").then((data) => data.user);

export const completeOnboarding = (input: {
  identifier: string;
  inviteCode?: string;
}) =>
  request<{ user: Profile }>("/api/me/onboarding", {
    method: "POST",
    body: JSON.stringify(input),
  }).then((data) => data.user);

// -------------------------------------------------------------- Submissions

export type SubmissionQuery = {
  status?: VerificationStatus;
  q?: string;
  take?: number;
  cursor?: string;
};

export const fetchSubmissions = (query: SubmissionQuery = {}) => {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.q) params.set("q", query.q);
  if (query.take) params.set("take", String(query.take));
  if (query.cursor) params.set("cursor", query.cursor);

  const qs = params.toString();
  return request<{ submissions: HistoryEntry[]; nextCursor: string | null }>(
    `/api/submissions${qs ? `?${qs}` : ""}`
  );
};

export type CreateSubmissionInput = {
  hash: string;
  fileName: string;
  thumbnailUrl?: string | null;
  metadata: {
    captureTime: string | null;
    latitude: number | null;
    longitude: number | null;
    locationName: string | null;
    device: string | null;
    gpsTagsPresent: boolean;
  };
  /** How the image reached the system — see `CaptureMode`. */
  captureMode?: CaptureMode;
  /** A device position offered with the submission, kept apart from the
   *  file's own coordinates. */
  location?: LocationAttestation | null;
};

/** The keys the current API predates. Stripped on a validation retry. */
const LOCATION_EXTENSION = ["captureMode", "location"] as const;

/**
 * Sends the derived record. Deliberately does not send a verdict — the server
 * re-derives it, so what comes back may differ from the browser's provisional
 * result (most often `Reused`, which only the server can know).
 *
 * `captureMode` and `location` are newer than the deployed API. Rather than
 * gate the whole feature on a server release, the call retries once without
 * them if the server rejects the body: an updated server persists the evidence,
 * an older one keeps accepting submissions, and neither needs to know about the
 * other. The caller still holds the attestation and merges it into the record
 * it shows, so the student's certificate is complete either way.
 */
export const createSubmission = async (input: CreateSubmissionInput) => {
  const send = (body: CreateSubmissionInput | Omit<CreateSubmissionInput, "captureMode" | "location">) =>
    request<{ submission: HistoryEntry; duplicateOfOtherUser: boolean }>(
      "/api/submissions",
      { method: "POST", body: JSON.stringify(body) }
    );

  try {
    return await send(input);
  } catch (error) {
    const rejectedTheBody =
      error instanceof ApiError && (error.status === 400 || error.status === 422);
    const carriedExtension = LOCATION_EXTENSION.some(
      (key) => input[key] != null
    );
    if (!rejectedTheBody || !carriedExtension) throw error;

    const { captureMode: _mode, location, ...core } = input;
    const legacyMetadata =
      input.captureMode === "witnessed" && location
        ? {
            ...core.metadata,
            latitude: location.latitude,
            longitude: location.longitude,
            gpsTagsPresent: true,
            locationName: location.locationName ?? core.metadata.locationName,
          }
        : core.metadata;

    return await send({ ...core, metadata: legacyMetadata });
  }
};

export const deleteSubmission = (id: string) =>
  request<void>(`/api/submissions/${id}`, { method: "DELETE" });

// -------------------------------------------------------------------- Stats

export type Stats = {
  total: number;
  verified: number;
  suspicious: number;
  reused: number;
  students: number;
};

export const fetchStats = () =>
  request<{ stats: Stats }>("/api/stats").then((data) => data.stats);
