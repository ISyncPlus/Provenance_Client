"use client";

import { useEffect, useState } from "react";
import { BrandMark } from "../../../components/ui/BrandLogo";

export default function AuthCallbackPage() {
  const [closing, setClosing] = useState(true);

  useEffect(() => {
    // 1. Notify opener via postMessage if opened as a popup
    try {
      if (window.opener) {
        window.opener.postMessage(
          { type: "PROVENANCE_AUTH_SUCCESS" },
          window.location.origin
        );
      }
    } catch {
      // Ignore cross-origin or closed opener issues
    }

    // 2. Broadcast via BroadcastChannel for modern browsers / separate tabs
    try {
      const channel = new BroadcastChannel("provenance_auth_channel");
      channel.postMessage({ type: "PROVENANCE_AUTH_SUCCESS" });
      channel.close();
    } catch {
      // Ignore if BroadcastChannel is not supported
    }

    // 3. Close the separate tab/window
    try {
      window.close();
    } catch {
      setClosing(false);
    }

    // 4. Fallback in case window.close() is blocked by browser policies
    const timer = setTimeout(() => {
      setClosing(false);
    }, 1200);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-canvas p-6 text-center text-ink">
      <div className="flex flex-col items-center gap-4">
        <BrandMark />
        <h1 className="t-title-3 font-medium">Authentication Verified</h1>
        <p className="t-footnote max-w-xs text-pretty text-ink-2">
          {closing
            ? "Closing this window and returning to your session..."
            : "You can close this tab and return to your main window."}
        </p>
        {!closing ? (
          <button
            type="button"
            onClick={() => window.close()}
            className="mt-2 rounded-full bg-accent px-5 py-2 text-sm font-medium text-accent-ink"
          >
            Close Window
          </button>
        ) : null}
      </div>
    </div>
  );
}
