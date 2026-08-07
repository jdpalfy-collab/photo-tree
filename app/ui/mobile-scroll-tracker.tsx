"use client";

import { useEffect, useState } from "react";

type ScrollState = {
  visible: boolean;
  topPct: number;
  heightPct: number;
};

export default function MobileScrollTracker() {
  const [state, setState] = useState<ScrollState>({
    visible: false,
    topPct: 0,
    heightPct: 100,
  });

  useEffect(() => {
    let scrollEl: HTMLElement | Window = window;
    const container = document.querySelector<HTMLElement>(".site-content");

    function getMetrics() {
      if (container) {
        return {
          scrollEl: container,
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight || 1,
        };
      }

      const doc = document.documentElement;
      return {
        scrollEl: window,
        scrollTop: window.scrollY,
        scrollHeight: Math.max(doc.scrollHeight, document.body.scrollHeight),
        clientHeight: window.innerHeight || doc.clientHeight || 1,
      };
    }

    function update() {
      const metrics = getMetrics();
      scrollEl = metrics.scrollEl;
      const { scrollTop, scrollHeight, clientHeight } = metrics;
      const maxScroll = Math.max(0, scrollHeight - clientHeight);

      if (maxScroll <= 8) {
        setState({ visible: false, topPct: 0, heightPct: 100 });
        return;
      }

      const heightPct = Math.max(12, Math.min(90, (clientHeight / scrollHeight) * 100));
      const topPct = Math.max(
        0,
        Math.min(100 - heightPct, (scrollTop / maxScroll) * (100 - heightPct))
      );
      setState({ visible: true, topPct, heightPct });
    }

    update();
    container?.addEventListener("scroll", update, { passive: true });
    if (!container) {
      window.addEventListener("scroll", update, { passive: true });
    }
    window.addEventListener("resize", update);

    const observedElement = container ?? document.documentElement;
    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    resizeObserver?.observe(observedElement);
    if (container) resizeObserver?.observe(document.documentElement);

    const mutationObserver =
      typeof MutationObserver !== "undefined" ? new MutationObserver(update) : null;
    mutationObserver?.observe(observedElement, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    const raf = window.requestAnimationFrame(update);
    const shortRefresh = window.setTimeout(update, 250);
    const imageRefresh = window.setTimeout(update, 1200);

    return () => {
      if (scrollEl instanceof Window) {
        window.removeEventListener("scroll", update);
      } else {
        scrollEl.removeEventListener("scroll", update);
      }
      window.removeEventListener("resize", update);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.cancelAnimationFrame(raf);
      window.clearTimeout(shortRefresh);
      window.clearTimeout(imageRefresh);
    };
  }, []);

  if (!state.visible) return null;

  return (
    <div className="mobile-page-scroll-tracker" aria-hidden="true">
      <span
        className="mobile-page-scroll-tracker__thumb"
        style={{
          top: `${state.topPct}%`,
          height: `${state.heightPct}%`,
        }}
      />
    </div>
  );
}
