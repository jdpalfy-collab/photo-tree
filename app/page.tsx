"use client";

import { signIn, signOut, useSession } from "next-auth/react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== "loading" && session) {
      const redirected = window.sessionStorage.getItem("photoTreeRedirected");
      if (!redirected) {
        window.sessionStorage.setItem("photoTreeRedirected", "1");
    router.replace("/family-tree-manual");
      }
    }
  }, [status, session, router]);

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>

      {status === "loading" && <p style={{ fontSize: 20 }}>Loading…</p>}

      {status !== "loading" && !session && (
        <>
          <div style={{ display: "grid", justifyItems: "center", gap: 16, marginTop: 24 }}>
            <img
              src="/ChatGPT%20Image%20Feb%2010,%202026,%2010_13_52%20PM.png"
              alt="PhotoTree"
              width={240}
              height={240}
              style={{ width: 240, height: 240, objectFit: "contain" }}
            />
            <div style={{ fontSize: 28, fontWeight: 700, color: "#1f2937" }}>
              Please sign in to access PhotoTree
            </div>
            <div style={{ textAlign: "center", width: "100%" }}>
              <button onClick={() => signIn("google")} style={{ fontSize: 18, padding: "10px 16px" }}>
                Sign in with Google
              </button>
            </div>
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
        </>
      )}
    </main>
  );
}
