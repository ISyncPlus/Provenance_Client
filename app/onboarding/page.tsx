"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import PageShell from "../../components/PageShell";
import AuthPanel from "../../components/AuthPanel";
import Field from "../../components/ui/Field";
import Reveal from "../../components/ui/Reveal";
import { Button } from "../../components/ui/Button";
import { Alert, Check, ShieldCheck } from "../../components/ui/icons";
import { BrandMark } from "../../components/ui/BrandLogo";
import { ApiError, completeOnboarding } from "../../lib/api";
import { useProfile } from "../../lib/useProfile";
import { fade, springMove } from "../../lib/motion";

/**
 * Claims a registration number or staff ID after sign-in.
 *
 * Note there is no "I am a lecturer" control. Reviewer access is requested by
 * entering a code the department issues, and granted — or refused — by the
 * server. A role the client can simply assert is a role every student assigns
 * themselves (ARCHITECTURE.md, Decision 3).
 */
export default function OnboardingPage() {
  const router = useRouter();
  const reduced = useReducedMotion();
  const { profile, loading } = useProfile();

  const [identifier, setIdentifier] = useState("");
  const [wantsReviewer, setWantsReviewer] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!profile) {
      router.replace("/login");
      return;
    }
    if (profile.onboarded) {
      router.replace(profile.role === "lecturer" ? "/lecturer" : "/student");
    }
  }, [loading, profile, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const trimmed = identifier.trim();
    if (trimmed.length < 4) {
      setError("Enter a valid registration number or staff ID.");
      return;
    }
    if (wantsReviewer && !inviteCode.trim()) {
      setError("Enter the reviewer invite code, or continue as a student.");
      return;
    }

    setSubmitting(true);
    try {
      const updated = await completeOnboarding({
        identifier: trimmed,
        ...(wantsReviewer ? { inviteCode: inviteCode.trim() } : {}),
      });
      router.replace(updated.role === "lecturer" ? "/lecturer" : "/student");
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not save your profile. Please try again."
      );
      setSubmitting(false);
    }
  };

  if (loading || !profile || profile.onboarded) {
    return (
      <PageShell>
        <Field pad="none" className="pt-16">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-4">
            <div className="shimmer h-3 w-24 rounded-sm bg-well" />
            <div className="shimmer h-9 w-56 rounded-sm bg-well" />
            <div className="shimmer mt-4 h-11 w-full rounded-sm bg-well" />
            <div className="shimmer h-24 w-full rounded-sm bg-well" />
          </div>
        </Field>
      </PageShell>
    );
  }

  /* Matches the sign-in form: a rule under each field, not a box around it. */
  const fieldClass =
    "t-callout min-h-11 w-full border-b border-line bg-transparent px-0 py-2.5 text-ink outline-none transition-colors duration-200 placeholder:text-ink-3 focus:border-accent";

  return (
    <PageShell>
      <Field bleed pad="none">
        <div className="grid lg:min-h-[calc(100dvh-7rem)] lg:grid-cols-2">
          <AuthPanel
            title="One identifier, attached to everything you file."
            lede="Your registration number travels with each verification record, so a reviewer can find your work without you naming it twice."
            points={[
              { mark: "Students", text: "A registration number is all that is required." },
              { mark: "Reviewers", text: "Access is granted by a departmental code, never self-claimed." },
              { mark: "Permanent", text: "The identifier is stamped on every certificate you print." },
            ]}
          />

          <div className="flex items-center justify-center px-5 py-14 sm:px-10">
            <Reveal className="w-full max-w-sm">
              <div className="lg:hidden">
                <BrandMark size={34} />
              </div>

              <div className="mt-6 flex items-center gap-4 lg:mt-0">
                <span className="t-mark text-accent-deep">Step 02</span>
                <span className="rule-draw h-px flex-1 bg-rule" />
              </div>

              <h1 className="t-title-1 mt-6 text-ink">One more step</h1>
              <p className="t-num mt-2 text-[0.8125rem] text-ink-2">
                {profile.email}
              </p>

              <form onSubmit={handleSubmit} className="mt-9 flex flex-col gap-7">
                <label className="flex flex-col gap-1">
                  <span className="t-mark text-ink-3">
                    Registration number or staff ID
                  </span>
                  <input
                    type="text"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    placeholder="2021/248001"
                    autoFocus
                    className={`${fieldClass} font-mono`}
                  />
                  <span className="t-caption mt-1.5 text-pretty text-ink-3">
                    This is attached to every submission you make, so a reviewer
                    can identify your work.
                  </span>
                </label>

                {/* Reviewer access is opt-in and code-gated. */}
                <div className="border-y border-rule py-5">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input
                      type="checkbox"
                      checked={wantsReviewer}
                      onChange={(event) => {
                        setWantsReviewer(event.target.checked);
                        setError(null);
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--brand)]"
                    />
                    <span className="min-w-0">
                      <span className="t-footnote flex items-center gap-1.5 font-semibold text-ink">
                        <ShieldCheck size={14} className="text-accent" />
                        I am a departmental reviewer
                      </span>
                      <span className="t-caption mt-1 block text-pretty text-ink-2">
                        Requires the invite code issued by the department.
                        Without it you continue as a student.
                      </span>
                    </span>
                  </label>

                  <AnimatePresence initial={false}>
                    {wantsReviewer ? (
                      <motion.div
                        initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                        transition={reduced ? fade : springMove}
                        className="overflow-hidden"
                      >
                        <input
                          type="password"
                          value={inviteCode}
                          onChange={(event) => setInviteCode(event.target.value)}
                          placeholder="Reviewer invite code"
                          className={`${fieldClass} mt-4 font-mono`}
                        />
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>

                <AnimatePresence initial={false}>
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
                  disabled={submitting}
                  arrow={!submitting}
                >
                  {submitting ? (
                    "Saving…"
                  ) : (
                    <>
                      <Check size={16} />
                      Continue
                    </>
                  )}
                </Button>
              </form>
            </Reveal>
          </div>
        </div>
      </Field>
    </PageShell>
  );
}
