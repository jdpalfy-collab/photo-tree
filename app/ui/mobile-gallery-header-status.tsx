"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type FilterOption = {
  id: string;
  label: string;
  checked: boolean;
};

type SelectOption = {
  value: string;
  label: string;
};

type PersonOption = {
  id: string;
  label: string;
};

type MobileGalleryHeaderStatusProps = {
  personName?: string;
  personId?: string;
  personOptions?: PersonOption[];
  onPersonChange?: (personId: string) => void;
  filterValue: string;
  filterOptions: FilterOption[];
  onFilterChange: (id: string, checked: boolean) => void;
  sortValue: string;
  sortMode: string;
  sortOptions: SelectOption[];
  onSortChange: (value: string) => void;
};

type ActivePanel = "person" | "filter" | "sort" | null;

export default function MobileGalleryHeaderStatus({
  personName,
  personId,
  personOptions = [],
  onPersonChange,
  filterValue,
  filterOptions,
  onFilterChange,
  sortValue,
  sortMode,
  sortOptions,
  onSortChange,
}: MobileGalleryHeaderStatusProps) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [activePanel, setActivePanel] = useState<ActivePanel>(null);

  useEffect(() => {
    setPortalTarget(document.getElementById("mobile-gallery-header-slot"));
  }, []);

  useEffect(() => {
    const active = Boolean(portalTarget);
    document.body.classList.toggle("mobile-gallery-status-active", active);
    document.body.classList.toggle("mobile-gallery-person-status-active", active && !!personName);
    return () => {
      document.body.classList.remove("mobile-gallery-status-active");
      document.body.classList.remove("mobile-gallery-person-status-active");
    };
  }, [portalTarget, personName]);

  useEffect(() => {
    if (!activePanel) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setActivePanel(null);
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [activePanel]);

  if (!portalTarget) return null;

  function togglePanel(panel: Exclude<ActivePanel, null>) {
    setActivePanel((current) => (current === panel ? null : panel));
  }

  return createPortal(
    <>
      {activePanel ? (
        <button
          type="button"
          className="mobile-gallery-header-dismiss"
          aria-label={`Close ${activePanel} options`}
          onClick={() => setActivePanel(null)}
        />
      ) : null}

      <div
        className={personName ? "mobile-gallery-header-status mobile-gallery-header-status--person" : "mobile-gallery-header-status"}
        aria-label="Current gallery view"
      >
        {personName ? (
          <button
            type="button"
            className="mobile-gallery-header-status__item mobile-gallery-header-status__item--person"
            aria-expanded={activePanel === "person"}
            onClick={() => togglePanel("person")}
          >
            <span>Person</span>
            <strong>{personName}</strong>
          </button>
        ) : null}
        <button
          type="button"
          className="mobile-gallery-header-status__item mobile-gallery-header-status__item--filter"
          aria-expanded={activePanel === "filter"}
          onClick={() => togglePanel("filter")}
        >
          <span>Filter</span>
          <strong>{filterValue}</strong>
        </button>
        <button
          type="button"
          className="mobile-gallery-header-status__item mobile-gallery-header-status__item--sort"
          aria-expanded={activePanel === "sort"}
          onClick={() => togglePanel("sort")}
        >
          <span>Sort</span>
          <strong>{sortValue}</strong>
        </button>
      </div>

      {activePanel ? (
        <div className="mobile-gallery-header-popover" role="dialog" aria-label={`${activePanel} options`}>
          {activePanel === "filter" ? (
            filterOptions.length > 0 ? (
              <div className="mobile-gallery-header-popover__options">
                {filterOptions.map((option) => (
                  <label key={option.id}>
                    <input
                      type="checkbox"
                      checked={option.checked}
                      onChange={(event) => onFilterChange(option.id, event.target.checked)}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="mobile-gallery-header-popover__empty">No filters available</div>
            )
          ) : null}

          {activePanel === "sort" ? (
            <div className="mobile-gallery-header-popover__options">
              {sortOptions.map((option) => (
                <label key={option.value}>
                  <input
                    type="radio"
                    name="mobile-gallery-sort"
                    checked={sortMode === option.value}
                    onChange={() => {
                      onSortChange(option.value);
                      setActivePanel(null);
                    }}
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          ) : null}

          {activePanel === "person" ? (
            personOptions.length > 0 ? (
              <div className="mobile-gallery-header-popover__options">
                {personOptions.map((option) => (
                  <label key={option.id}>
                    <input
                      type="radio"
                      name="mobile-gallery-person"
                      checked={personId === option.id}
                      onChange={() => {
                        onPersonChange?.(option.id);
                        setActivePanel(null);
                      }}
                    />
                    <span>{option.label}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="mobile-gallery-header-popover__empty">No people available</div>
            )
          ) : null}
        </div>
      ) : null}
    </>,
    portalTarget
  );
}
