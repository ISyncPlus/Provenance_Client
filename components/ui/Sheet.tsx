"use client";

import {
  animate,
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { project, rubberband, springSheet } from "../../lib/motion";
import { useReducedTransparency } from "../../lib/useMediaQuery";
import { Close } from "./icons";

type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
};

type Sample = { t: number; y: number };

/** Velocity in px/s over the last ~100ms of pointer history, not the last frame. */
const velocityFrom = (samples: Sample[]): number => {
  if (samples.length < 2) return 0;
  const latest = samples[samples.length - 1];
  let oldest = samples[samples.length - 2];
  for (let i = samples.length - 1; i >= 0; i -= 1) {
    if (latest.t - samples[i].t > 100) break;
    oldest = samples[i];
  }
  const dt = latest.t - oldest.t;
  return dt > 0 ? ((latest.y - oldest.y) / dt) * 1000 : 0;
};

const DRAG_THRESHOLD = 10;

/**
 * A bottom sheet that can be grabbed, thrown, and caught again mid-flight.
 *
 * It tracks the pointer 1:1 from wherever it was grabbed, resists progressively
 * past its top bound, projects where a flick would land to decide dismiss vs.
 * settle, and hands the release velocity to the spring so there is no seam
 * between the drag and the animation. It enters from the bottom and leaves the
 * same way.
 */
export default function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: SheetProps) {
  const reduced = useReducedMotion();
  const opaque = useReducedTransparency();
  const [mounted, setMounted] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const heightRef = useRef(600);
  const releaseVelocity = useRef(0);
  const restoreFocus = useRef<HTMLElement | null>(null);

  const y = useMotionValue(0);
  const fade = useMotionValue(0);

  /** Scrim tracks the drag continuously — feedback during, not only after. */
  const progress = useTransform(y, (latest) =>
    Math.min(Math.max(1 - latest / heightRef.current, 0), 1)
  );
  const scrimOpacity = useTransform(() => progress.get() * fade.get());
  const scrimBlur = useTransform(progress, [0, 1], [0, 8]);
  const scrimFilter = useMotionTemplate`blur(${scrimBlur}px)`;

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  /* Enter: measure, park below the fold, then spring up. */
  useLayoutEffect(() => {
    if (!mounted || !open) return;
    heightRef.current = panelRef.current?.offsetHeight ?? 600;

    restoreFocus.current = document.activeElement as HTMLElement | null;
    document.documentElement.dataset.sheetOpen = "true";
    document.body.style.overflow = "hidden";
    panelRef.current?.focus({ preventScroll: true });

    if (reduced) {
      y.jump(0);
      const f = animate(fade, 1, { duration: 0.18 });
      return () => f.stop();
    }

    y.jump(heightRef.current);
    fade.jump(1);
    const controls = animate(y, 0, springSheet);
    return () => controls.stop();
  }, [mounted, open, reduced, y, fade]);

  /* Exit: continue from wherever the sheet currently is, at the velocity the
     finger left it with. */
  useEffect(() => {
    if (open || !mounted) return;

    const finish = () => {
      setMounted(false);
      releaseVelocity.current = 0;
      delete document.documentElement.dataset.sheetOpen;
      document.body.style.overflow = "";
      restoreFocus.current?.focus?.();
    };

    if (reduced) {
      const controls = animate(fade, 0, { duration: 0.18, onComplete: finish });
      return () => controls.stop();
    }

    const controls = animate(y, heightRef.current, {
      ...springSheet,
      velocity: releaseVelocity.current,
      onComplete: finish,
    });
    return () => controls.stop();
  }, [open, mounted, reduced, y, fade]);

  useEffect(() => {
    if (!mounted) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mounted, onClose]);

  useEffect(
    () => () => {
      delete document.documentElement.dataset.sheetOpen;
      document.body.style.overflow = "";
    },
    []
  );

  /* ------------------------------------------------------------ Gesture */

  const drag = useRef({
    active: false,
    committed: false,
    startPointer: 0,
    startValue: 0,
    samples: [] as Sample[],
  });

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (reduced || event.button !== 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      /* Catch whatever is in flight and take over from its live position. */
      y.stop();
      drag.current = {
        active: true,
        committed: false,
        startPointer: event.clientY,
        startValue: y.get(),
        samples: [{ t: performance.now(), y: event.clientY }],
      };
    },
    [reduced, y]
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state.active) return;

      const delta = event.clientY - state.startPointer;
      if (!state.committed) {
        if (Math.abs(delta) < DRAG_THRESHOLD) return;
        state.committed = true;
      }

      state.samples.push({ t: performance.now(), y: event.clientY });
      if (state.samples.length > 12) state.samples.shift();

      const raw = state.startValue + delta;
      /* Past the top bound the sheet follows less and less, instead of
         hitting a wall. */
      y.set(raw < 0 ? -rubberband(-raw, heightRef.current) : raw);
    },
    [y]
  );

  const endDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const state = drag.current;
      if (!state.active) return;
      state.active = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (!state.committed) return;

      const velocity = velocityFrom(state.samples);
      /* Decide against where the throw would land, not where the finger
         happened to lift. */
      const projected = y.get() + project(velocity);

      if (projected > heightRef.current * 0.4) {
        releaseVelocity.current = velocity;
        onClose();
        return;
      }

      animate(y, 0, { ...springSheet, velocity });
    },
    [onClose, y]
  );

  if (!mounted || typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <motion.button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          opacity: scrimOpacity,
          backdropFilter: opaque ? undefined : scrimFilter,
        }}
        className="absolute inset-0 h-full w-full cursor-default bg-scrim"
      />

      <motion.div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-lenis-prevent
        style={{ y, opacity: reduced ? fade : 1 }}
        className="material relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border-t border-material-edge shadow-sheet outline-none backdrop-blur-2xl backdrop-saturate-[180%] sm:mb-4 sm:rounded-xl sm:border"
      >
          <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="shrink-0 cursor-grab touch-none px-6 pb-4 pt-3 active:cursor-grabbing"
        >
          <div className="mx-auto h-1 w-9 rounded-full bg-line-strong" />
          <div className="mt-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="t-title-2 on-material truncate text-ink">{title}</h2>
                {subtitle ? (
                  <p className="t-footnote mt-1 truncate text-ink-2">{subtitle}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close submission details"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 transition-colors hover:bg-well hover:text-ink"
              >
                <Close size={17} />
              </button>
          </div>
        </div>

        <div
          data-lenis-prevent
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pb-[max(2rem,env(safe-area-inset-bottom))]"
        >
          {children}
        </div>
      </motion.div>
    </div>,
    document.body
  );
}
