"use client";

import { useEditingMode } from "../providers";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

export default function Header() {
  const { mode, setMode } = useEditingMode();
  const { data: session, status } = useSession();
  const isAuthed = status === "loading" ? false : !!session;
  const pathname = usePathname();
  const isActive = (href: string) => pathname === href;

  return (
    <header className="site-header">
      <div className="site-header__inner">
        <div className="brand">
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
        </div>
        <nav className="nav-links">
          {isAuthed ? (
            <>
              <a
                href="/family-tree-manual"
                className={isActive("/family-tree-manual") ? "nav-active" : undefined}
              >
                Tree
              </a>
              <a href="/people" className={isActive("/people") ? "nav-active" : undefined}>
                People
              </a>
              <a href="/saved" className={isActive("/saved") ? "nav-active" : undefined}>
                Photos
              </a>
              <a href="/picker" className={isActive("/picker") ? "nav-active" : undefined}>
                Import
              </a>
              <div className="mode-switch">
                <select
                  value={mode}
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
            <a href="/" className={isActive("/") ? "nav-active" : undefined}>
              Account
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
