"use client";

import { SessionProvider } from "next-auth/react";
import { createContext, useContext, useMemo, useState, useEffect } from "react";

type EditingMode = "editing" | "viewing";

const EditingModeContext = createContext<{
  mode: EditingMode;
  setMode: (mode: EditingMode) => void;
}>({
  mode: "viewing",
  setMode: () => {},
});

export function useEditingMode() {
  return useContext(EditingModeContext);
}

export function Providers({
  children,
  initialMode,
}: {
  children: React.ReactNode;
  initialMode?: EditingMode;
}) {
  const [mode, setMode] = useState<EditingMode>(() => {
    if (typeof window === "undefined") return initialMode ?? "viewing";
    const stored = window.localStorage.getItem("photoTreeMode");
    if (stored === "editing" || stored === "viewing") return stored;
    return initialMode ?? "viewing";
  });

  const value = useMemo(
    () => ({
      mode,
      setMode: (next: EditingMode) => {
        setMode(next);
        if (typeof window !== "undefined") {
          window.localStorage.setItem("photoTreeMode", next);
          document.cookie = `photoTreeMode=${next}; path=/; max-age=31536000`;
        }
      },
    }),
    [mode]
  );

  useEffect(() => {
    if (typeof window !== "undefined") {
      document.cookie = `photoTreeMode=${mode}; path=/; max-age=31536000`;
    }
  }, [mode]);

  // Edit-lock disabled for now.

  return (
    <SessionProvider>
      <EditingModeContext.Provider value={value}>{children}</EditingModeContext.Provider>
    </SessionProvider>
  );
}
