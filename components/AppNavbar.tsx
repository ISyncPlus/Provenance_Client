"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { signOut } from "../lib/auth-client";
import type { Profile } from "../lib/api";
import ThemeToggle from "./ui/ThemeToggle";
import { ArrowRight, Close, SignOut } from "./ui/icons";
import { BrandMark } from "./ui/BrandLogo";
import UserAvatar from "./UserAvatar";
import { fade, springMove, springSnappy } from "../lib/motion";

type AppNavbarProps = {
  session?: Profile | null;
};

const CONDENSE_ABOVE = 36;
const RELEASE_BELOW = 12;
let isCondensed = false;

const subscribeToScroll = (callback: () => void): (() => void) => {
  window.addEventListener("scroll", callback, { passive: true });
  return () => window.removeEventListener("scroll", callback);
};

const getCondensedSnapshot = (): boolean => {
  if (typeof window === "undefined") return false;
  const y = window.scrollY;
  isCondensed = isCondensed ? y > RELEASE_BELOW : y > CONDENSE_ABOVE;
  return isCondensed;
};

const getServerCondensed = (): boolean => false;

/* The active section lives in the URL hash, which is browser state rather than
   React state. Reading it through an external store keeps the server render
   (always "") and the client render in agreement, instead of writing it into
   state from an effect and re-rendering the whole header a frame later. */
const subscribeToHash = (callback: () => void): (() => void) => {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("hashchange", callback);
    window.removeEventListener("popstate", callback);
  };
};

const getHashSnapshot = (): string =>
  typeof window === "undefined" ? "" : window.location.hash;

const getServerHash = (): string => "";

type NavLink = {
  label: string;
  href: string;
  /** Present when the link scrolls to a section of the landing page. */
  targetId?: string;
};

const NAV_LINKS: readonly NavLink[] = [
  { label: "Demo", href: "/#interactive-demo", targetId: "interactive-demo" },
  { label: "Method", href: "/#method", targetId: "method" },
  { label: "Cases", href: "/case-studies" },
  { label: "Team", href: "/#team", targetId: "team" },
  { label: "FAQ", href: "/#faq", targetId: "faq" },
];

/* One glass recipe, so the three islands read as pieces of the same pane
   rather than three separately-styled bars. */
const ISLAND =
  "material material-pill rounded-full border border-material-edge backdrop-blur-[18px] backdrop-saturate-[180%]";

/**
 * The navigation splits into three floating islands — identity, route, action —
 * rather than one bar glued to the top edge. Detaching it lets the page scroll
 * visibly beneath the chrome on all four sides, which is what makes the glass
 * read as a layer above the document instead of a strip cut out of it.
 */
export default function AppNavbar({ session }: AppNavbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const reduced = useReducedMotion();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const condensed = useSyncExternalStore(
    subscribeToScroll,
    getCondensedSnapshot,
    getServerCondensed
  );

  const hash = useSyncExternalStore(
    subscribeToHash,
    getHashSnapshot,
    getServerHash
  );

  /* An open full-screen menu owns the viewport; the page behind it must not
     scroll away underneath. */
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);

    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [mobileMenuOpen]);

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  const handleNavClick = useCallback(
    (
      event: React.MouseEvent<HTMLAnchorElement>,
      targetId?: string
    ) => {
      if (!targetId || pathname !== "/") return;
      const element = document.getElementById(targetId);
      if (!element) return;

      event.preventDefault();
      element.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
      /* pushState deliberately does not fire hashchange, so the store that
         drives the active-link thumb has to be told the hash moved. */
      window.history.pushState(null, "", `#${targetId}`);
      window.dispatchEvent(new Event("hashchange"));
      setMobileMenuOpen(false);
    },
    [pathname, reduced]
  );

  const isActive = (link: NavLink) =>
    link.href === pathname ||
    (Boolean(link.targetId) && hash === `#${link.targetId}`);

  return (
    <>
      <header className="sticky top-0 z-40 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 sm:pt-4">
        <motion.div
          initial={false}
          animate={{ paddingTop: condensed ? 0 : 4 }}
          transition={reduced ? { duration: 0 } : springMove}
            className="mx-auto flex w-full max-w-344 items-center justify-between gap-3"
        >
          {/* ------------------------------------------- Island 1: identity */}
          <motion.div
            layout
            transition={reduced ? { duration: 0 } : springMove}
            className="flex min-w-0 shrink-0 items-center"
          >
            <Link
              href="/"
              className={`${ISLAND} group relative z-10 flex min-w-0 items-center gap-2.5 py-2 pl-3 pr-4 transition-transform duration-150 active:scale-[0.98]`}
            >
              <span className="text-ink transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:rotate-90">
                <BrandMark size={22} />
              </span>
              <span className="min-w-0">
                <span className="t-mark on-material block truncate text-ink">
                  Provenance
                </span>
                <AnimatePresence initial={false}>
                  {!condensed ? (
                    <motion.span
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={fade}
                      className="t-mark block overflow-hidden text-[0.5625rem] text-ink-3 xl:whitespace-nowrap"
                    >
                      IMVS · UNIZIK
                    </motion.span>
                  ) : null}
                </AnimatePresence>
              </span>
            </Link>
          </motion.div>

          {/* ---------------------------------------------- Island 2: route */}
          <motion.nav
            layout
            transition={reduced ? { duration: 0 } : springMove}
            aria-label="Sections"
            className={`${ISLAND} relative z-10 hidden items-center gap-0.5 p-1 md:flex`}
          >
            {NAV_LINKS.map((link) => {
              const active = isActive(link);
              return (
                <Link
                  key={link.label}
                  href={link.href}
                  onClick={(event) => handleNavClick(event, link.targetId)}
                  aria-current={active ? "page" : undefined}
                  className="relative rounded-full px-3 py-1.5 lg:px-3.5"
                >
                  {/* One thumb that travels, rather than a highlight that
                      blinks from one link to the next. */}
                  {active ? (
                    reduced ? (
                      <span className="absolute inset-0 rounded-full bg-accent" />
                    ) : (
                      <motion.span
                        layoutId="nav-thumb"
                        transition={springSnappy}
                        className="absolute inset-0 rounded-full bg-accent shadow-accent"
                      />
                    )
                  ) : null}
                  <span
                    className={`t-mark relative z-10 transition-colors duration-150 ${
                      active
                        ? "text-accent-ink"
                        : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    {link.label}
                  </span>
                </Link>
              );
            })}
          </motion.nav>

          {/* --------------------------------------------- Island 3: action */}
          <motion.div
            layout
            transition={reduced ? { duration: 0 } : springMove}
            className={`${ISLAND} relative z-10 flex shrink-0 items-center gap-1.5 p-1.5`}
          >
            {session ? (
              <>
                <AnimatePresence initial={false}>
                  {!condensed ? (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: "auto" }}
                      exit={{ opacity: 0, width: 0 }}
                      transition={reduced ? { duration: 0 } : springMove}
                      className="hidden overflow-hidden whitespace-nowrap pl-2 text-right lg:block"
                    >
                      <span className="t-footnote on-material block truncate font-semibold text-ink">
                        {session.name}
                      </span>
                      <span className="t-mark block truncate text-[0.5625rem] text-ink-3">
                        {session.role}
                        {session.identifier ? ` · ${session.identifier}` : ""}
                      </span>
                    </motion.span>
                  ) : null}
                </AnimatePresence>

                <UserAvatar
                  name={session.name}
                  image={session.image}
                  size="md"
                  className="ring-1 ring-accent-edge"
                />

                <ThemeToggle />

                <motion.button
                  type="button"
                  onClick={() => void handleSignOut()}
                  aria-label="Sign out"
                  whileTap={reduced ? { opacity: 0.7 } : { scale: 0.92 }}
                  transition={springMove}
                  className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line text-ink-2 transition-colors duration-150 hover:border-bad hover:text-bad sm:flex"
                >
                  <SignOut size={15} />
                </motion.button>
              </>
            ) : (
              <>
                <ThemeToggle />
                {/* Button-in-button: the arrow lives in its own well, flush
                    with the inner padding, and drifts on hover. */}
                <Link
                  href="/login"
                  className="group hidden items-center gap-2 rounded-full bg-accent py-1 pl-4 pr-1 text-accent-ink shadow-accent transition-transform duration-200 active:scale-[0.97] sm:inline-flex"
                >
                  <span className="t-mark">Sign in</span>
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black/15 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5 group-hover:scale-105">
                    <ArrowRight size={13} strokeWidth={2.2} />
                  </span>
                </Link>
              </>
            )}

            {/* -------------------------------------- Hamburger, morphing */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-label={mobileMenuOpen ? "Close menu" : "Open navigation menu"}
              aria-expanded={mobileMenuOpen}
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line text-ink transition-colors hover:bg-well md:hidden"
            >
              <span className="relative block h-3 w-4">
                <motion.span
                  animate={
                    mobileMenuOpen
                      ? { rotate: 45, y: 5.5 }
                      : { rotate: 0, y: 0 }
                  }
                  transition={reduced ? { duration: 0 } : springSnappy}
                  className="absolute left-0 top-0 block h-[1.5px] w-4 rounded-full bg-current"
                />
                <motion.span
                  animate={
                    mobileMenuOpen
                      ? { rotate: -45, y: -5.5 }
                      : { rotate: 0, y: 0 }
                  }
                  transition={reduced ? { duration: 0 } : springSnappy}
                  className="absolute bottom-0 left-0 block h-[1.5px] w-4 rounded-full bg-current"
                />
              </span>
            </button>
          </motion.div>
        </motion.div>
      </header>

      {/* ------------------------------------------ Full-screen menu overlay */}
      <AnimatePresence>
        {mobileMenuOpen ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="fixed inset-0 z-45 flex flex-col justify-end bg-canvas/85 px-5 pt-24 pb-[max(2rem,env(safe-area-inset-bottom))] backdrop-blur-2xl md:hidden"
          >
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close navigation menu"
              className="absolute right-5 top-[max(1.25rem,env(safe-area-inset-top))] flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink transition-colors hover:bg-well"
            >
              <Close size={18} />
            </button>
            <motion.nav
              aria-label="Site"
              initial="hidden"
              animate="shown"
              exit="hidden"
              variants={{
                shown: { transition: { staggerChildren: 0.05, delayChildren: 0.06 } },
                hidden: { transition: { staggerChildren: 0.02, staggerDirection: -1 } },
              }}
              className="ruled border-t border-rule"
            >
              {NAV_LINKS.map((link, index) => (
                <motion.div
                  key={link.label}
                  variants={{
                    /* The link rises out of an invisible box rather than
                       fading in place — a mask reveal, staggered. */
                    hidden: reduced
                      ? { opacity: 0 }
                      : { opacity: 0, y: 26, filter: "blur(5px)" },
                    shown: reduced
                      ? { opacity: 1 }
                      : { opacity: 1, y: 0, filter: "blur(0px)" },
                  }}
                  transition={{ type: "spring", bounce: 0, duration: 0.5 }}
                >
                  <Link
                    href={link.href}
                    onClick={(event) => {
                      handleNavClick(event, link.targetId);
                      /* Route links navigate away; closing here rather than
                         from a pathname effect avoids a render pass whose only
                         job is to undo state the click already resolved. */
                      setMobileMenuOpen(false);
                    }}
                    className="group flex items-baseline justify-between gap-4 py-4"
                  >
                    <span className="t-title-1 text-ink transition-colors group-active:text-accent">
                      {link.label}
                    </span>
                    <span className="t-mark text-ink-3">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </Link>
                </motion.div>
              ))}
            </motion.nav>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ delay: 0.2, duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="mt-8 flex flex-col gap-2"
            >
              <Link
                href={
                  session
                    ? session.role === "lecturer"
                      ? "/lecturer"
                      : "/student"
                    : "/login"
                }
                className="group flex items-center justify-between rounded-full bg-accent py-2 pl-6 pr-2 text-accent-ink shadow-accent"
              >
                <span className="t-callout font-semibold">
                  {session
                    ? `Open ${session.role === "lecturer" ? "the ledger" : "the inspector"}`
                    : "Sign in to Provenance"}
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/15 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-active:translate-x-1">
                  <ArrowRight size={16} strokeWidth={2.2} />
                </span>
              </Link>
              {session ? (
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    void handleSignOut();
                  }}
                  className="t-mark flex items-center justify-center gap-2 rounded-full border border-line py-3 text-ink-2 transition-colors active:border-bad active:text-bad"
                >
                  <SignOut size={14} />
                  Sign out
                </button>
              ) : null}

              <Link
                href="/privacy"
                className="t-mark py-3 text-center text-ink-3"
              >
                Privacy &amp; data policy
              </Link>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
