"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import PageShell from "../../components/PageShell";
import AuthPanel from "../../components/AuthPanel";
import Field from "../../components/ui/Field";
import Reveal from "../../components/ui/Reveal";
import SegmentedControl from "../../components/ui/SegmentedControl";
import { Button } from "../../components/ui/Button";
import { Alert, Eye, EyeOff, Check } from "../../components/ui/icons";
import { GoogleGlyph, GitHubGlyph } from "../../components/ui/ProviderGlyphs";
import { BrandMark } from "../../components/ui/BrandLogo";
import { ApiError, fetchProfile } from "../../lib/api";
import {
  enabledProviders,
  signIn,
  signUp,
  useSession,
} from "../../lib/auth-client";
import { fade, springMove } from "../../lib/motion";

type Mode = "signin" | "signup";
const MODES: readonly Mode[] = ["signin", "signup"];

const MODE_LABEL: Record<Mode, string> = {
  signin: "Sign in",
  signup: "Create account",
};

export default function LoginPage() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const { data: session, isPending } = useSession();

  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * Intelligently routes the user: if already onboarded, goes directly to their
   * dashboard (/student or /lecturer). Only new/un-onboarded users land on /onboarding.
   */
  const routeAfterAuth = async () => {
    try {
      const profile = await fetchProfile();
      if (profile?.onboarded) {
        router.replace(profile.role === "lecturer" ? "/lecturer" : "/student");
      } else {
        router.replace("/onboarding");
      }
    } catch {
      router.replace("/onboarding");
    }
  };

  useEffect(() => {
    if (!isPending && session?.user) {
      void routeAfterAuth();
    }
  }, [isPending, session]);

  const oauth = async (provider: "google" | "github") => {
    setError(null);
    setBusy(provider);

    // 1. Open popup window synchronously on user click to avoid popup blockers
    const width = 520;
    const height = 640;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2.5);

    const popup = window.open(
      "about:blank",
      "provenance_oauth_popup",
      `width=${width},height=${height},left=${left},top=${top},status=no,menubar=no,toolbar=no`
    );

    let finished = false;
    let cleanupListeners: () => void = () => {};

    const onAuthComplete = () => {
      if (finished) return;
      finished = true;
      cleanupListeners();
      try {
        if (popup && !popup.closed) popup.close();
      } catch {
        // ignore
      }
      setBusy(provider);
      void routeAfterAuth();
    };

    const handleMessage = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data?.type === "PROVENANCE_AUTH_SUCCESS"
      ) {
        onAuthComplete();
      }
    };

    window.addEventListener("message", handleMessage);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel("provenance_auth_channel");
      channel.onmessage = (event) => {
        if (event.data?.type === "PROVENANCE_AUTH_SUCCESS") {
          onAuthComplete();
        }
      };
    } catch {
      // BroadcastChannel not available in all contexts
    }

    // Monitor popup closed state as a fallback
    const pollTimer = setInterval(() => {
      if (!popup || popup.closed) {
        clearInterval(pollTimer);
        setTimeout(() => {
          if (!finished) {
            void fetchProfile()
              .then((profile) => {
                if (profile) {
                  onAuthComplete();
                } else {
                  setBusy(null);
                }
              })
              .catch(() => {
                setBusy(null);
              });
          }
        }, 600);
      }
    }, 600);

    cleanupListeners = () => {
      window.removeEventListener("message", handleMessage);
      clearInterval(pollTimer);
      if (channel) {
        try {
          channel.close();
        } catch {
          // ignore
        }
      }
    };

    try {
      const res = await signIn.social({
        provider,
        callbackURL: `${window.location.origin}/auth/callback`,
        disableRedirect: true,
      });

      if (res?.error) {
        cleanupListeners();
        try {
          popup?.close();
        } catch {
          // ignore
        }
        setError(
          res.error.message ||
            `${provider === "google" ? "Google" : "GitHub"} OAuth is not configured on the backend. Please sign in with email or set ${provider === "google" ? "GOOGLE_CLIENT_ID" : "GITHUB_CLIENT_ID"} in the server .env.`
        );
        setBusy(null);
        return;
      }

      const authUrl = res?.data?.url;
      if (authUrl) {
        if (popup && !popup.closed) {
          popup.location.href = authUrl;
        } else {
          // Fallback if popup was blocked by browser: redirect current tab
          cleanupListeners();
          window.location.href = authUrl;
        }
      } else {
        cleanupListeners();
        try {
          popup?.close();
        } catch {
          // ignore
        }
        setError("Could not retrieve authorization URL.");
        setBusy(null);
      }
    } catch (err: unknown) {
      cleanupListeners();
      try {
        popup?.close();
      } catch {
        // ignore
      }
      const message =
        err instanceof Error ? err.message : "Authentication request failed.";
      setError(
        `${message} Check that the backend server is running on :4000 and ${provider === "google" ? "Google" : "GitHub"} OAuth is configured.`
      );
      setBusy(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (mode === "signup" && name.trim().length < 3) {
      setError("Enter your full name.");
      return;
    }
    if (!email.includes("@")) {
      setError("Enter a valid email address.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setBusy("email");

    try {
      if (mode === "signup") {
        const res = await signUp.email({
          email,
          password,
          name: name.trim(),
        });
        if (res?.error) {
          setError(res.error.message || "Failed to create account.");
          setBusy(null);
          return;
        }
        router.replace("/onboarding");
      } else {
        const res = await signIn.email({
          email,
          password,
        });
        if (res?.error) {
          setError(res.error.message || "Invalid email or password.");
          setBusy(null);
          return;
        }
        await routeAfterAuth();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Connection failed.";
      setError(`${message} Ensure the backend server is running on port 4000.`);
      setBusy(null);
    }
  };

  /* Underlined rather than boxed: on a form this short, four boxes stacked in
     a column is four competing rectangles, and the rule already says where the
     field is. The accent arrives on focus. */
  const fieldClass =
    "t-callout min-h-11 w-full border-b border-line bg-transparent px-0 py-2.5 text-ink outline-none transition-colors duration-200 placeholder:text-ink-3 focus:border-accent";

  const anyOAuth = enabledProviders.google || enabledProviders.github;

  return (
    <PageShell>
      <Field bleed pad="none">
        <div className="grid lg:min-h-[calc(100dvh-7rem)] lg:grid-cols-2">
          <AuthPanel
            title="Proof of origin, before the marking starts."
            lede="Sign in to check a coursework photograph against what its own camera recorded — or to audit what the department has filed."
            points={[
              { mark: "Local", text: "Images are read on your device and never uploaded." },
              { mark: "Ledger", text: "Duplicate detection runs across every student." },
              { mark: "Archival", text: "Every verdict prints as a certificate." },
            ]}
          />

          <div className="flex items-center justify-center px-5 py-14 sm:px-10">
            <Reveal className="w-full max-w-sm">
              <div className="lg:hidden">
                <BrandMark size={34} />
              </div>

              <div className="mt-6 flex items-center gap-4 lg:mt-0">
                <span className="t-mark text-accent-deep">Access</span>
                <span className="rule-draw h-px flex-1 bg-rule" />
              </div>

              <h1 className="t-title-1 mt-6 text-ink">
                {mode === "signin" ? "Sign in" : "Create an account"}
              </h1>
              <p className="t-footnote mt-2 text-ink-2">
                Faculty of Physical Sciences, Nnamdi Azikiwe University
              </p>

              <div className="mt-7">
                <SegmentedControl
                  options={MODES}
                  value={mode}
                  onChange={(next) => {
                    setMode(next);
                    setError(null);
                  }}
                  label="Sign in or create an account"
                  className="w-full"
                  render={(option) => <span>{MODE_LABEL[option]}</span>}
                />
              </div>

              {anyOAuth ? (
                <>
                  <div className="mt-6 flex flex-col gap-2.5">
                    {enabledProviders.google ? (
                      <Button
                        variant="secondary"
                        size="lg"
                        className="w-full"
                        disabled={busy !== null}
                        onClick={() => void oauth("google")}
                      >
                        <GoogleGlyph size={18} />
                        {busy === "google" ? "Redirecting…" : "Continue with Google"}
                      </Button>
                    ) : null}
                    {enabledProviders.github ? (
                      <Button
                        variant="secondary"
                        size="lg"
                        className="w-full"
                        disabled={busy !== null}
                        onClick={() => void oauth("github")}
                      >
                        <GitHubGlyph size={18} />
                        {busy === "github" ? "Redirecting…" : "Continue with GitHub"}
                      </Button>
                    ) : null}
                  </div>

                  <div className="my-7 flex items-center gap-4">
                    <span className="h-px flex-1 bg-rule" />
                    <span className="t-mark text-ink-3">or by email</span>
                    <span className="h-px flex-1 bg-rule" />
                  </div>
                </>
              ) : null}

              <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                {/* Height animates so the form grows into the extra field
                    rather than jumping between two layouts. */}
                <AnimatePresence initial={false}>
                  {mode === "signup" ? (
                    <motion.label
                      initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                      transition={reduced ? fade : springMove}
                      className="flex flex-col gap-1 overflow-hidden"
                    >
                      <span className="t-mark text-ink-3">Full name</span>
                      <input
                        type="text"
                        value={name}
                        autoComplete="name"
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Chidera Nwosu"
                        className={fieldClass}
                      />
                    </motion.label>
                  ) : null}
                </AnimatePresence>

                <label className="flex flex-col gap-1">
                  <span className="t-mark text-ink-3">Email</span>
                  <input
                    type="email"
                    value={email}
                    autoComplete="email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@unizik.edu.ng"
                    className={fieldClass}
                  />
                </label>

                <label className="flex flex-col gap-1">
                  <span className="t-mark text-ink-3">Password</span>
                  <div className="relative flex items-center">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      autoComplete={
                        mode === "signup" ? "new-password" : "current-password"
                      }
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="At least 8 characters"
                      className={`${fieldClass} pr-9`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      className="absolute right-0 flex h-11 w-11 items-center justify-center text-ink-3 transition-colors hover:text-ink"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </label>

                <AnimatePresence initial={false}>
                  {successMsg ? (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={fade}
                      className="t-footnote flex items-start gap-2 rounded-sm border-l-2 border-good bg-good-wash px-3.5 py-2.5 text-good"
                    >
                      <Check size={14} strokeWidth={2.2} className="mt-0.5 shrink-0" />
                      {successMsg}
                    </motion.p>
                  ) : null}

                  {error ? (
                    <motion.p
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={fade}
                      className="t-footnote flex items-start gap-2 rounded-sm border-l-2 border-bad bg-bad-wash px-3.5 py-2.5 text-bad"
                    >
                      <Alert size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
                      {error}
                    </motion.p>
                  ) : null}
                </AnimatePresence>

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  className="w-full"
                  disabled={busy !== null}
                  arrow={busy === null}
                >
                  {busy === "email" ? "Working…" : MODE_LABEL[mode]}
                </Button>
              </form>

              <p className="t-caption mt-8 text-pretty text-ink-3">
                New accounts start as students. Reviewer access is granted with a
                departmental invite code on the next step.
              </p>
            </Reveal>
          </div>
        </div>
      </Field>
    </PageShell>
  );
}
