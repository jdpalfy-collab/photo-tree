"use client";

import { useEditingMode, useGuestAccess } from "../providers";
import { startPhotoTreeSignIn } from "../lib/mobile-sign-in";
import { signOut, useSession } from "next-auth/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export default function Header() {
  const { mode, setMode, editLockState, editLockNotice } = useEditingMode();
  const isEditingMode = mode === "editing";
  const { data: session, status } = useSession();
  const { guestAccess } = useGuestAccess();
  const isAuthed = status === "loading" ? guestAccess : !!session || guestAccess;
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href;
  const [menuOpen, setMenuOpen] = useState(false);
  const [landscapeNavOpen, setLandscapeNavOpen] = useState(false);
  const mobilePageTitle = pathname.startsWith("/family-tree-manual")
    ? "Tree"
    : pathname.startsWith("/people")
    ? "People"
    : pathname.startsWith("/saved")
    ? "Photos"
    : pathname.startsWith("/picker")
    ? "Import"
    : pathname.startsWith("/family-tree/")
    ? "Person"
    : pathname === "/"
    ? "Account"
    : "PhotoTree";

  useEffect(() => {
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
  }, []);

  useEffect(() => {
    document.body.classList.toggle("mobile-tabs-active", isAuthed);
    return () => {
      document.body.classList.remove("mobile-tabs-active");
    };
  }, [isAuthed]);

  function resetScroll() {
    const content = document.querySelector<HTMLElement>(".site-content");
    content?.scrollTo({ top: 0, left: 0 });
    window.scrollTo({ top: 0, left: 0 });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  useEffect(() => {
    setMenuOpen(false);
    setLandscapeNavOpen(false);
    resetScroll();
    window.requestAnimationFrame(resetScroll);
    window.setTimeout(resetScroll, 80);
    window.setTimeout(resetScroll, 240);
  }, [pathname]);

  const navItems = [
    { href: "/family-tree-manual", label: "Tree" },
    { href: "/people", label: "People" },
    { href: "/saved", label: "Photos" },
    { href: "/picker", label: "Import" },
  ];
  const mobileTabs = [
    {
      href: "/family-tree-manual",
      label: "Tree",
      icon: (
        <svg className="mobile-tab-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 21V11" />
          <path d="M8 21h8" />
          <path d="M12 16 8.5 11.5" />
          <path d="M12 15.5 15.5 11.5" />
          <path d="M6.8 14.2a3.4 3.4 0 0 1-.6-6.7A4.6 4.6 0 0 1 14.8 6a4.2 4.2 0 0 1 4.4 4.2 3.6 3.6 0 0 1-3.7 3.8H6.8z" />
        </svg>
      ),
    },
    {
      href: "/people",
      label: "People",
      icon: (
        <svg className="mobile-tab-icon mobile-tab-icon--people" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="8" r="3.4" />
          <path d="M7.8 21v-2.2c0-3.2 1.7-5.2 4.2-5.2s4.2 2 4.2 5.2V21" />
          <circle cx="6.2" cy="9.3" r="2.7" />
          <path d="M2.6 19.2v-1.5c0-2.5 1.4-4.1 3.6-4.1 1 0 1.9.3 2.5 1" />
          <circle cx="17.8" cy="9.3" r="2.7" />
          <path d="M21.4 19.2v-1.5c0-2.5-1.4-4.1-3.6-4.1-1 0-1.9.3-2.5 1" />
        </svg>
      ),
    },
    {
      href: "/saved",
      label: "Photos",
      icon: (
        <svg className="mobile-tab-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M5 5h14v14H5z" />
          <path d="m7 16 3.5-4 2.5 3 2-2.2 2 3.2" />
          <path d="M15.5 8.5h.01" />
        </svg>
      ),
    },
    {
      href: "/picker",
      label: "Import",
      icon: (
        <svg className="mobile-tab-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M12 4v10" />
          <path d="m8 8 4-4 4 4" />
          <path d="M5 14v4h14v-4" />
        </svg>
      ),
    },
  ];
  const currentMobileTab =
    mobileTabs.find((item) => isActive(item.href)) ||
    (pathname.startsWith("/family-tree/")
      ? mobileTabs.find((item) => item.href === "/people")
      : mobileTabs[0]);

  return (
    <>
      <header className="site-header">
        <div className="site-header__inner">
          <div className="mobile-page-title">{mobilePageTitle}</div>
          {isAuthed ? (
            <button
              type="button"
              className="mobile-landscape-nav-button"
              aria-label={landscapeNavOpen ? "Close page navigation" : "Open page navigation"}
              aria-expanded={landscapeNavOpen}
              onClick={() => {
                setMenuOpen(false);
                setLandscapeNavOpen((open) => !open);
              }}
            >
              {currentMobileTab?.icon}
            </button>
          ) : null}
          {isAuthed ? (
            <button
              type="button"
              className={isEditingMode ? "mobile-menu-button mobile-menu-button--editing" : "mobile-menu-button"}
              aria-label={menuOpen ? "Close account menu" : "Open account menu"}
              aria-expanded={menuOpen}
              onClick={() => {
                setLandscapeNavOpen(false);
                setMenuOpen((open) => !open);
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M20 21a8 8 0 0 0-16 0" />
                <circle cx="12" cy="8" r="4" />
              </svg>
            </button>
          ) : null}
          <Link className="brand" href="/family-tree-manual" aria-label="Go to Tree">
            <div className="brand__mark">
              <img
                src="/ChatGPT%20Image%20Feb%2010,%202026,%2010_13_52%20PM.png"
                alt="PhotoTree Logo"
                width={42}
                height={42}
                style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }}
              />
            </div>
            <div className="brand__text">
              <div className="brand__name">PhotoTree</div>
            </div>
          </Link>
          <div id="mobile-gallery-header-slot" className="mobile-gallery-header-slot" />
          <nav className="nav-links">
            {isAuthed ? (
              <>
                {navItems.slice(0, 4).map((item) => (
                  <Link key={item.href} href={item.href} className={isActive(item.href) ? "nav-active" : undefined}>
                    {item.label}
                  </Link>
                ))}
                <div className={isEditingMode ? "mode-switch mode-switch--editing" : "mode-switch"}>
                  <select
                    value={mode}
                    disabled={editLockState === "acquiring"}
                    onChange={(e) => setMode(e.target.value as "editing" | "viewing")}
                    aria-label="Editing mode"
                  >
                    {mode === "editing" ? (
                      <>
                        <option value="editing">Editing Mode</option>
                        <option value="viewing">Viewing Mode</option>
                      </>
                    ) : (
                      <>
                        <option value="viewing">Viewing Mode</option>
                        <option value="editing">Editing Mode</option>
                      </>
                    )}
                  </select>
                </div>
              </>
            ) : (
              <></>
            )}
            {isAuthed ? (
              <Link href="/" className={isActive("/") ? "nav-active" : undefined}>
                Account
              </Link>
            ) : null}
          </nav>
        </div>
      </header>
      {editLockNotice ? (
        <div className="edit-lock-notice" data-state={editLockState} role="status">
          {editLockNotice}
        </div>
      ) : null}
      {isAuthed ? (
        <>
          <div
            className={menuOpen || landscapeNavOpen ? "mobile-menu-backdrop mobile-menu-backdrop--open" : "mobile-menu-backdrop"}
            onClick={() => {
              setMenuOpen(false);
              setLandscapeNavOpen(false);
            }}
          />
          <nav
            className={landscapeNavOpen ? "mobile-landscape-nav-menu mobile-landscape-nav-menu--open" : "mobile-landscape-nav-menu"}
            aria-label="Page navigation"
          >
            {mobileTabs.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={isActive(item.href) ? "nav-active" : undefined}
                onClick={() => {
                  setLandscapeNavOpen(false);
                  resetScroll();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            ))}
          </nav>
          <nav className={menuOpen ? "mobile-menu mobile-menu--open" : "mobile-menu"} aria-label="Account and mode">
            <button
              type="button"
              className="mobile-menu-close"
              aria-label="Close account menu"
              onClick={() => setMenuOpen(false)}
            >
              x
            </button>
            <div className="mobile-account-summary">
              <span>Account</span>
              <div className="mobile-account-row">
                <strong>{session?.user?.email || session?.user?.name || "Without Google Photos"}</strong>
                {session ? (
                  <button
                    type="button"
                    className="mobile-signout-button mobile-signout-button--inline"
                    onClick={() => {
                      setMenuOpen(false);
                      void signOut({ callbackUrl: "/" });
                    }}
                  >
                    Log out
                  </button>
                ) : (
                  <button
                    type="button"
                    className="mobile-signout-button mobile-signout-button--inline"
                    onClick={() => {
                      setMenuOpen(false);
                      void startPhotoTreeSignIn(pathname);
                    }}
                  >
                    Connect Google Photos
                  </button>
                )}
              </div>
            </div>
            <div className="mobile-account-summary">
              <span>Info</span>
              <div className="mobile-account-row">
                <Link href="/privacy" onClick={() => setMenuOpen(false)}>
                  Privacy
                </Link>
                <Link href="/support" onClick={() => setMenuOpen(false)}>
                  Support
                </Link>
              </div>
            </div>
            <div
              className={isEditingMode ? "mobile-mode-switch mobile-mode-switch--editing" : "mobile-mode-switch"}
              aria-label="Editing mode"
            >
              <span>Mode</span>
              <select
                value={mode}
                disabled={editLockState === "acquiring"}
                onChange={(e) => setMode(e.target.value as "editing" | "viewing")}
                aria-label="Editing mode"
              >
                <option value="viewing">Viewing</option>
                <option value="editing">Editing</option>
              </select>
            </div>
          </nav>
          <nav className="mobile-tab-bar" aria-label="Primary mobile navigation">
            {mobileTabs.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={isActive(item.href) ? "nav-active" : undefined}
                onClick={() => {
                  setMenuOpen(false);
                  resetScroll();
                }}
              >
                {item.icon}
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </>
      ) : null}
    </>
  );
}
