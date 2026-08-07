"use client";

import { SessionProvider, useSession } from "next-auth/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import MobileAuthListener from "./ui/mobile-auth-listener";

type EditingMode = "editing" | "viewing";
type EditLockState = "idle" | "acquiring" | "held" | "blocked" | "error";

const EditingModeContext = createContext<{
  mode: EditingMode;
  setMode: (mode: EditingMode) => void;
  editLockState: EditLockState;
  editLockNotice: string;
  editingSessionId: string | null;
}>({
  mode: "viewing",
  setMode: () => {},
  editLockState: "idle",
  editLockNotice: "",
  editingSessionId: null,
});

const GuestAccessContext = createContext<{
  guestAccess: boolean;
  enableGuestAccess: () => void;
}>({
  guestAccess: false,
  enableGuestAccess: () => {},
});

export function useEditingMode() {
  return useContext(EditingModeContext);
}

export function useGuestAccess() {
  return useContext(GuestAccessContext);
}

function PhotoTreeProviders({
  children,
  initialMode,
}: {
  children: React.ReactNode;
  initialMode?: EditingMode;
}) {
  const { data: session } = useSession();
  const [mode, setModeState] = useState<EditingMode>("viewing");
  const [editLockState, setEditLockState] = useState<EditLockState>("idle");
  const [editLockNotice, setEditLockNotice] = useState("");
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [guestAccess, setGuestAccess] = useState(false);
  const autoAcquireAttemptedRef = useRef(false);

  useEffect(() => {
    const hasStoredGuestAccess = window.localStorage.getItem("photoTreeGuestAccess") === "1";
    if (hasStoredGuestAccess) {
      document.cookie = "photoTreeGuestAccess=1; path=/; max-age=31536000; SameSite=Lax";
    }
    let editorId = window.sessionStorage.getItem("photoTreeEditingSessionId");
    if (!editorId) {
      editorId = window.crypto.randomUUID();
      window.sessionStorage.setItem("photoTreeEditingSessionId", editorId);
    }
    window.queueMicrotask(() => {
      setGuestAccess(hasStoredGuestAccess);
      setEditingSessionId(editorId);
    });
  }, []);

  const persistMode = useCallback((next: EditingMode) => {
    window.localStorage.setItem("photoTreeMode", next);
    document.cookie = `photoTreeMode=${next}; path=/; max-age=31536000; SameSite=Lax`;
  }, []);

  const acquireEditingLease = useCallback(
    async (heartbeat = false) => {
      if (!editingSessionId) return false;
      if (!heartbeat) {
        setEditLockState("acquiring");
        setEditLockNotice("Checking the latest saved tree...");
      }

      try {
        const holderName = session?.user?.email || session?.user?.name || "Another iOS device";
        const response = await fetch("/api/edit-lock", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ editorId: editingSessionId, holderName }),
          cache: "no-store",
        });
        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          const owner = result?.lock?.holderName || "another device";
          setModeState("viewing");
          persistMode("viewing");
          if (response.status === 409) {
            setEditLockState("blocked");
            setEditLockNotice(`The tree is currently being edited by ${owner}. Viewing Mode is still available.`);
          } else {
            setEditLockState("error");
            setEditLockNotice("Editing could not be started. Please try again after the connection is restored.");
          }
          return false;
        }

        setEditLockState("held");
        setEditLockNotice("");
        setModeState("editing");
        persistMode("editing");
        return true;
      } catch {
        setModeState("viewing");
        persistMode("viewing");
        setEditLockState("error");
        setEditLockNotice("Editing could not be started. Please try again after the connection is restored.");
        return false;
      }
    },
    [editingSessionId, persistMode, session]
  );

  const leaveEditing = useCallback(() => {
    setModeState("viewing");
    persistMode("viewing");
    setEditLockState("idle");
    setEditLockNotice("");
    if (!editingSessionId) return;
    void fetch("/api/edit-lock", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ editorId: editingSessionId }),
      keepalive: true,
    }).catch(() => {});
  }, [editingSessionId, persistMode]);

  useEffect(() => {
    if (!editingSessionId || autoAcquireAttemptedRef.current) return;
    autoAcquireAttemptedRef.current = true;
    const storedMode = window.localStorage.getItem("photoTreeMode");
    if (storedMode === "editing" || initialMode === "editing") {
      const request = window.setTimeout(() => void acquireEditingLease(), 0);
      return () => window.clearTimeout(request);
    }
    persistMode("viewing");
  }, [acquireEditingLease, editingSessionId, initialMode, persistMode]);

  useEffect(() => {
    if (mode !== "editing" || editLockState !== "held") return;
    const heartbeat = window.setInterval(() => {
      void acquireEditingLease(true);
    }, 30_000);
    return () => window.clearInterval(heartbeat);
  }, [acquireEditingLease, editLockState, mode]);

  const editingValue = useMemo(
    () => ({
      mode,
      editLockState,
      editLockNotice,
      editingSessionId,
      setMode: (next: EditingMode) => {
        if (next === "viewing") {
          leaveEditing();
          return;
        }
        if (mode === "editing" && editLockState === "held") return;
        void acquireEditingLease();
      },
    }),
    [acquireEditingLease, editLockNotice, editLockState, editingSessionId, leaveEditing, mode]
  );

  return (
    <GuestAccessContext.Provider
      value={{
        guestAccess,
        enableGuestAccess: () => {
          window.localStorage.setItem("photoTreeGuestAccess", "1");
          document.cookie = "photoTreeGuestAccess=1; path=/; max-age=31536000; SameSite=Lax";
          setGuestAccess(true);
        },
      }}
    >
      <EditingModeContext.Provider value={editingValue}>
        <MobileAuthListener />
        {children}
      </EditingModeContext.Provider>
    </GuestAccessContext.Provider>
  );
}

export function Providers({
  children,
  initialMode,
}: {
  children: React.ReactNode;
  initialMode?: EditingMode;
}) {
  return (
    <SessionProvider>
      <PhotoTreeProviders initialMode={initialMode}>{children}</PhotoTreeProviders>
    </SessionProvider>
  );
}
