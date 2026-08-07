"use client";

import { signOut, useSession } from "next-auth/react";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startPhotoTreeSignIn } from "./lib/mobile-sign-in";
import { useGuestAccess } from "./providers";

type FamilyAccessState = {
  loading: boolean;
  required: boolean;
  unlocked: boolean;
};

export default function Home() {
  const { data: session, status } = useSession();
  const { guestAccess, enableGuestAccess } = useGuestAccess();
  const router = useRouter();
  const [familyAccess, setFamilyAccess] = useState<FamilyAccessState>({
    loading: true,
    required: false,
    unlocked: false,
  });
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);

  const familyGateOpen =
    !familyAccess.loading && (!familyAccess.required || familyAccess.unlocked);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/family-access", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setFamilyAccess({
          loading: false,
          required: Boolean(data?.required),
          unlocked: Boolean(data?.unlocked),
        });
      })
      .catch(() => {
        if (cancelled) return;
        setFamilyAccess({ loading: false, required: false, unlocked: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (familyGateOpen && status !== "loading" && (session || guestAccess)) {
      if (!session && guestAccess) {
        router.replace("/family-tree-manual");
        return;
      }
      const mobileTarget = getMobileAuthTarget();
      if (mobileTarget) {
        window.location.replace(
          `/mobile-auth/redirect?target=${encodeURIComponent(mobileTarget)}`
        );
        return;
      }
      router.replace("/family-tree-manual");
    }
  }, [familyGateOpen, status, session, guestAccess, router]);

  async function submitInviteCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError("");
    setInviteSubmitting(true);
    try {
      const response = await fetch("/api/family-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: inviteCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data?.ok) {
        setInviteError(data?.error || "That invite code was not recognized.");
        return;
      }
      setFamilyAccess({
        loading: false,
        required: Boolean(data?.required),
        unlocked: Boolean(data?.unlocked),
      });
      setInviteCode("");
    } finally {
      setInviteSubmitting(false);
    }
  }

  return (
    <main className="home-main" style={{ padding: 24, fontFamily: "system-ui" }}>

      {(status === "loading" || familyAccess.loading) && <p style={{ fontSize: 20 }}>Loading...</p>}

      {!familyAccess.loading && familyAccess.required && !familyAccess.unlocked && (
        <div className="home-signin" style={{ display: "grid", justifyItems: "center", gap: 16, marginTop: 24 }}>
          <img
            className="home-signin__logo"
            src="/ChatGPT%20Image%20Feb%2010,%202026,%2010_13_52%20PM.png"
            alt="PhotoTree"
            width={240}
            height={240}
            style={{ width: 240, height: 240, objectFit: "contain" }}
          />
          <div className="home-signin__title" style={{ fontSize: 28, fontWeight: 700, color: "#1f2937" }}>
            Enter family invite code
          </div>
          <form
            onSubmit={submitInviteCode}
            style={{ display: "grid", justifyItems: "center", gap: 12, textAlign: "center", width: "100%", maxWidth: 360 }}
          >
            <input
              value={inviteCode}
              onChange={(event) => setInviteCode(event.target.value)}
              autoComplete="one-time-code"
              aria-label="Family invite code"
              placeholder="Invite code"
              style={{ width: "100%", fontSize: 18, padding: "12px 14px", borderRadius: 8, border: "1px solid #cbd5e1" }}
            />
            {inviteError ? <p style={{ margin: 0, color: "#b91c1c" }}>{inviteError}</p> : null}
            <button
              type="submit"
              disabled={inviteSubmitting || !inviteCode.trim()}
              style={{ fontSize: 18, padding: "10px 16px" }}
            >
              {inviteSubmitting ? "Checking..." : "Continue"}
            </button>
          </form>
          <InfoLinks />
        </div>
      )}

      {familyGateOpen && status !== "loading" && !session && !guestAccess && (
        <>
          <div className="home-signin" style={{ display: "grid", justifyItems: "center", gap: 16, marginTop: 24 }}>
            <img
              className="home-signin__logo"
              src="/ChatGPT%20Image%20Feb%2010,%202026,%2010_13_52%20PM.png"
              alt="PhotoTree"
              width={240}
              height={240}
              style={{ width: 240, height: 240, objectFit: "contain" }}
            />
            <div className="home-signin__title" style={{ fontSize: 28, fontWeight: 700, color: "#1f2937" }}>
              Choose how to continue
            </div>
            <div style={{ display: "grid", justifyItems: "center", gap: 12, textAlign: "center", width: "100%" }}>
              <button
                onClick={() => {
                  void startPhotoTreeSignIn("/family-tree-manual");
                }}
                style={{ fontSize: 18, padding: "10px 16px" }}
              >
                Connect Google Photos
              </button>
              <button
                onClick={() => {
                  enableGuestAccess();
                  router.replace("/family-tree-manual");
                }}
                style={{ fontSize: 18, padding: "10px 16px" }}
              >
                Continue without Google Photos
              </button>
            </div>
            <InfoLinks />
          </div>
        </>
      )}

      {session && (
        <>
          <p style={{ textAlign: "right", fontSize: 22 }}>
            Signed in as <b>{session.user?.email}</b>
          </p>
          <div style={{ textAlign: "right" }}>
            <button
              onClick={() => {
                window.sessionStorage.removeItem("photoTreeRedirected");
                signOut();
              }}
              style={{ fontSize: 18, padding: "10px 16px" }}
            >
              Sign out
            </button>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <InfoLinks />
          </div>
        </>
      )}
    </main>
  );
}

function InfoLinks() {
  return (
    <div style={{ display: "flex", gap: 14, fontSize: 14 }}>
      <a href="/privacy">Privacy</a>
      <a href="/support">Support</a>
    </div>
  );
}

function getMobileAuthTarget() {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie
    .split("; ")
    .find((item) => item.startsWith("photoTreeMobileAuth="));
  if (!cookie) return null;
  const value = decodeURIComponent(cookie.slice("photoTreeMobileAuth=".length));
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return "/family-tree-manual";
  }
  return value;
}
