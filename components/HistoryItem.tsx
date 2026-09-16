"use client";

import Image from "next/image";
import StatusBadge from "./StatusBadge";
import { Pressable } from "./ui/Button";
import { ChevronRight } from "./ui/icons";
import { formatDateTime } from "../lib/format";
import type { HistoryEntry } from "../lib/types";

type HistoryItemProps = {
  entry: HistoryEntry;
  showSubmitter?: boolean;
  onOpen: () => void;
};

/**
 * A record in the file: a ruled row, not a card.
 *
 * A list of twenty submissions is a list, and boxing each one costs a border,
 * a shadow and a gap per item while communicating nothing — the rule between
 * two rows already says they are separate. What earns the ink instead is the
 * evidence: the thumbnail, the digest, and the verdict.
 */
export default function HistoryItem({
  entry,
  showSubmitter = false,
  onOpen,
}: HistoryItemProps) {
  const checkedAt = formatDateTime(entry.checkedAt);

  return (
    <Pressable
      onClick={onOpen}
      aria-label={`Open verification details for ${entry.fileName}`}
      className="group relative flex w-full items-center gap-2.5 py-3 pl-3 pr-2 transition-colors duration-200 hover:bg-well sm:gap-3.5"
    >
      {/* The wipe marks which row the pointer owns without moving anything. */}
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-0.5 origin-center scale-y-0 bg-accent transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-y-100"
      />

      <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-sm bg-well ring-1 ring-line">
        {entry.previewUrl ? (
          <Image
            src={entry.previewUrl}
            alt=""
            width={44}
            height={44}
            unoptimized
            className="h-full w-full object-cover"
          />
        ) : null}
      </span>

      <span className="min-w-0 flex-1">
        <span className="t-footnote block truncate font-semibold text-ink">
          {entry.fileName}
        </span>
        <span className="t-num mt-0.5 block truncate text-[0.6875rem] text-ink-3">
          {showSubmitter && entry.submittedBy
            ? `${entry.submittedBy.identifier || entry.submittedBy.name} · ${checkedAt}`
            : `${entry.hash.slice(0, 12)}… · ${checkedAt}`}
        </span>
      </span>

      <span className="shrink-0 max-sm:hidden">
        <StatusBadge status={entry.status} dot />
      </span>
      <span className="t-mark shrink-0 sm:hidden">
        {entry.status}
      </span>
      <ChevronRight
        size={15}
        className="shrink-0 text-ink-3 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5"
      />
    </Pressable>
  );
}
