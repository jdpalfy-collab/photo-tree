"use client";

import { App, URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { useEffect } from "react";

const processedLinkKey = "photoTreeProcessedDeepLinks";

function hasProcessedUrl(url: string) {
  try {
    const raw = window.sessionStorage.getItem(processedLinkKey);
    const urls = raw ? (JSON.parse(raw) as string[]) : [];
    return urls.includes(url);
  } catch {
    return false;
  }
}

function markProcessedUrl(url: string) {
  try {
    const raw = window.sessionStorage.getItem(processedLinkKey);
    const urls = raw ? (JSON.parse(raw) as string[]) : [];
    const next = [url, ...urls.filter((item) => item !== url)].slice(0, 10);
    window.sessionStorage.setItem(processedLinkKey, JSON.stringify(next));
  } catch {
    // If storage is unavailable, the handoff still works; it just cannot be de-duped.
  }
}

function openMobileAuthUrl(url: string) {
  if (hasProcessedUrl(url)) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return;
  }

  if (parsed.protocol !== "phototree:" || parsed.hostname !== "auth") {
    return;
  }

  const token = parsed.searchParams.get("token");
  const target = parsed.searchParams.get("target") || "/family-tree-manual";
  if (!token) return;

  markProcessedUrl(url);
  void Browser.close().catch(() => undefined);

  const completeUrl = `/mobile-auth/complete?token=${encodeURIComponent(
    token
  )}&target=${encodeURIComponent(target)}`;
  window.location.replace(completeUrl);
}

export default function MobileAuthListener() {
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let mounted = true;
    let removeListener: undefined | (() => Promise<void>);

    App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
      openMobileAuthUrl(event.url);
    }).then((handle) => {
      removeListener = () => handle.remove();
    });

    App.getLaunchUrl().then((launch) => {
      if (mounted && launch?.url) {
        openMobileAuthUrl(launch.url);
      }
    });

    return () => {
      mounted = false;
      void removeListener?.();
    };
  }, []);

  return null;
}
