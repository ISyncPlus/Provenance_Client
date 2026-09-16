import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  subtitle?: string;
  /** Mono stamp above the title — what kind of record this card holds. */
  mark?: string;
  actions?: ReactNode;
  children: ReactNode;
  /**
   * Seats the card in an outer tray, the way a glass plate sits in a machined
   * housing: two concentric radii, an outer hairline, and a recessed ground.
   * Reserved for the one card a screen is actually about.
   */
  bezel?: boolean;
  /** Drop the body padding — for tables and lists that rule to the edge. */
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
};

/**
 * A card is a solid surface with a hairline edge — deliberately not a
 * translucent material. Stacking translucency on translucency is where
 * legibility goes to die; the floating chrome gets the glass, content does not.
 *
 * Cards are also deliberately rare here. Most groupings in this design are
 * made with rules and space (`.ruled`); a card is for content that genuinely
 * sits *above* the page, not merely beside it.
 */
export default function Card({
  title,
  subtitle,
  mark,
  actions,
  children,
  bezel = false,
  flush = false,
  className = "",
  bodyClassName = "",
}: CardProps) {
  const card = (
    <section
      className={`flex w-full min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-card ${
        bezel ? "" : className
      }`}
    >
      {title || actions || mark ? (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-rule bg-surface-2/50 px-4 py-3.5 sm:px-5 sm:py-4">
          <div className="min-w-0 flex-1">
            {mark ? (
              <p className="t-mark mb-1 text-accent-deep">{mark}</p>
            ) : null}
            {title ? <h2 className="t-title-3 truncate text-ink">{title}</h2> : null}
            {subtitle ? (
              <p className="t-footnote mt-0.5 text-pretty text-ink-2">{subtitle}</p>
            ) : null}
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {actions}
            </div>
          ) : null}
        </header>
      ) : null}

      <div
        className={`min-h-0 min-w-0 max-w-full flex-1 ${flush ? "" : "p-3.5 sm:p-5"} ${bodyClassName}`}
      >
        {children}
      </div>
    </section>
  );

  if (!bezel) return card;

  return (
    <div
      className={`w-full min-w-0 max-w-full rounded-[0.875rem] border border-line bg-well p-1.5 shadow-lift ${className}`}
    >
      {card}
    </div>
  );
}
