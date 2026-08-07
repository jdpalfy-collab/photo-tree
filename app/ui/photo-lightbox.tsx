"use client";

import { useEffect, useRef, useState } from "react";

type PhotoLightboxProps = {
  src: string;
  alt: string;
  rotation?: number | null;
  caption?: string | null;
  year?: string | null;
  people?: Array<{ id: string; name: string }>;
  getPersonHref?: (personId: string) => string;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
};

function touchDistance(touches: { [index: number]: { clientX: number; clientY: number } }) {
  const first = touches[0];
  const second = touches[1];
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

function touchCenter(touches: { [index: number]: { clientX: number; clientY: number } }) {
  const first = touches[0];
  const second = touches[1];
  return {
    x: (first.clientX + second.clientX) / 2,
    y: (first.clientY + second.clientY) / 2,
  };
}

function clampZoom(value: number) {
  return Math.max(1, Math.min(4, Math.round(value * 100) / 100));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type Point = { x: number; y: number };

type TouchState =
  | {
      mode: "pinch";
      distance: number;
      zoom: number;
      contentX: number;
      contentY: number;
    }
  | {
      mode: "pan";
      startX: number;
      startY: number;
      startOffset: Point;
    }
  | {
      mode: "swipe";
      startX: number;
      startY: number;
    };

export default function PhotoLightbox({
  src,
  alt,
  rotation = 0,
  caption,
  year,
  people = [],
  getPersonHref,
  onClose,
  onPrev,
  onNext,
}: PhotoLightboxProps) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const frameRef = useRef<HTMLDivElement | null>(null);
  const touchRef = useRef<TouchState | null>(null);
  const captionText = [caption, year].filter(Boolean).join(", ");
  const linkedPeople = Array.from(
    new Map(people.filter((person) => person.id && person.name).map((person) => [person.id, person])).values()
  );

  function clampOffset(next: Point, nextZoom = zoom) {
    const frame = frameRef.current;
    if (!frame || nextZoom <= 1) return { x: 0, y: 0 };
    const rect = frame.getBoundingClientRect();
    const maxX = (rect.width * (nextZoom - 1)) / 2;
    const maxY = (rect.height * (nextZoom - 1)) / 2;
    return {
      x: clamp(next.x, -maxX, maxX),
      y: clamp(next.y, -maxY, maxY),
    };
  }

  useEffect(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    touchRef.current = null;
  }, [src]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft") onPrev();
      if (e.key === "ArrowRight") onNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onNext, onPrev]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(248,250,252,0.55)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 90,
        padding: 12,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ position: "relative", width: "94vw", maxWidth: 1400, height: "88vh" }}
      >
        <button
          type="button"
          aria-label="Close image viewer"
          onClick={onClose}
          style={{
            position: "fixed",
            top: "calc(var(--mobile-header-height, 0px) + 12px)",
            right: 12,
            zIndex: 102,
            width: 36,
            height: 36,
            minHeight: 36,
            padding: 0,
            borderRadius: 999,
            border: "1px solid #dbeafe",
            background: "#fff",
            color: "#0b1f3a",
            fontSize: 24,
            lineHeight: 1,
            boxShadow: "0 8px 24px rgba(15,23,42,0.16)",
          }}
        >
          x
        </button>
        <div
          ref={frameRef}
          onDoubleClick={() => {
            setZoom((current) => {
              const nextZoom = current > 1 ? 1 : 2;
              setOffset({ x: 0, y: 0 });
              return nextZoom;
            });
          }}
          onTouchStart={(e) => {
            if (e.touches.length === 2) {
              const frame = frameRef.current;
              if (!frame) return;
              const rect = frame.getBoundingClientRect();
              const center = touchCenter(e.touches);
              const localX = center.x - rect.left;
              const localY = center.y - rect.top;
              touchRef.current = {
                mode: "pinch",
                distance: touchDistance(e.touches),
                zoom,
                contentX: (localX - rect.width / 2 - offset.x) / zoom,
                contentY: (localY - rect.height / 2 - offset.y) / zoom,
              };
              return;
            }

            if (e.touches.length === 1) {
              const touch = e.touches[0];
              touchRef.current =
                zoom > 1
                  ? {
                      mode: "pan",
                      startX: touch.clientX,
                      startY: touch.clientY,
                      startOffset: offset,
                    }
                  : {
                      mode: "swipe",
                      startX: touch.clientX,
                      startY: touch.clientY,
                    };
            }
          }}
          onTouchMove={(e) => {
            const state = touchRef.current;
            if (!state) return;

            if (state.mode === "pinch" && e.touches.length === 2) {
              const frame = frameRef.current;
              if (!frame) return;
              e.preventDefault();
              const rect = frame.getBoundingClientRect();
              const center = touchCenter(e.touches);
              const localX = center.x - rect.left;
              const localY = center.y - rect.top;
              const nextZoom = clampZoom(state.zoom * (touchDistance(e.touches) / state.distance));
              const nextOffset = clampOffset(
                {
                  x: localX - rect.width / 2 - state.contentX * nextZoom,
                  y: localY - rect.height / 2 - state.contentY * nextZoom,
                },
                nextZoom
              );
              setZoom(nextZoom);
              setOffset(nextOffset);
              return;
            }

            if (state.mode === "pan" && e.touches.length === 1) {
              e.preventDefault();
              const touch = e.touches[0];
              setOffset(
                clampOffset({
                  x: state.startOffset.x + touch.clientX - state.startX,
                  y: state.startOffset.y + touch.clientY - state.startY,
                })
              );
            }
          }}
          onTouchEnd={(e) => {
            const state = touchRef.current;
            if (state?.mode === "swipe" && e.changedTouches.length > 0) {
              const touch = e.changedTouches[0];
              const dx = touch.clientX - state.startX;
              const dy = touch.clientY - state.startY;
              if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.2) {
                if (dx > 0) onPrev();
                else onNext();
              }
            }

            if (e.touches.length === 0) {
              touchRef.current = null;
            } else if (e.touches.length === 1 && zoom > 1) {
              const touch = e.touches[0];
              touchRef.current = {
                mode: "pan",
                startX: touch.clientX,
                startY: touch.clientY,
                startOffset: offset,
              };
            }
          }}
          onTouchCancel={() => {
            touchRef.current = null;
          }}
          style={{
            width: "100%",
            height: "88vh",
            borderRadius: 10,
            overflow: "hidden",
            background: "transparent",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            touchAction: "none",
          }}
        >
          <img
            key={`${src}:${rotation || 0}`}
            src={src}
            alt={alt}
            draggable={false}
            onDragStart={(e) => e.preventDefault()}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
              transformOrigin: "center",
              transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation || 0}deg) scale(${zoom})`,
            }}
          />
        </div>
        <button
          type="button"
          aria-label="Previous photo"
          className="photo-lightbox__nav photo-lightbox__nav--prev"
          onClick={onPrev}
        >
          {"<"}
        </button>
        <button
          type="button"
          aria-label="Next photo"
          className="photo-lightbox__nav photo-lightbox__nav--next"
          onClick={onNext}
        >
          {">"}
        </button>
        {captionText || linkedPeople.length > 0 ? (
          <div className="photo-lightbox__details">
            {captionText ? <div className="photo-lightbox__year">{captionText}</div> : null}
            {linkedPeople.length > 0 ? (
              <div className="photo-lightbox__people" aria-label="People in this photo">
                {linkedPeople.map((person) => (
                  <a
                    key={person.id}
                    className="photo-lightbox__person-pill"
                    href={getPersonHref ? getPersonHref(person.id) : `/family-tree/${encodeURIComponent(person.id)}`}
                  >
                    {person.name}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
