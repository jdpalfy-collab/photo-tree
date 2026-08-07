"use client";

import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";

export async function startPhotoTreeSignIn(targetPath: string) {
  const path = `/mobile-auth/start?target=${encodeURIComponent(targetPath)}`;

  if (Capacitor.isNativePlatform()) {
    await Browser.open({
      url: new URL(path, window.location.origin).toString(),
      presentationStyle: "fullscreen",
    });
    return;
  }

  window.location.href =
    `/api/auth/signin/google?callbackUrl=${encodeURIComponent(targetPath)}`;
}
