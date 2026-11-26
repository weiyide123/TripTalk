"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { JaneAvatar } from "./JaneAvatar";
export function AppShell({
  children,
  title,
  subtitle,
  label,
  compact = false,
  busy = false,
  onHome,
  onFavorites,
  activePage = "learning",
}: {
  children: ReactNode;
  title?: ReactNode;
  subtitle?: string;
  label?: string;
  compact?: boolean;
  busy?: boolean;
  onHome?: () => void;
  onFavorites?: () => void;
  activePage?: "learning" | "favorites";
}) {
  return (
    <div className={"app-shell" + (compact ? " lesson-shell" : "")}>
      <header className="topbar">
        <BrandLink
          busy={busy}
          onHome={onHome}
        />
        <span className="nav-divider" />
        <nav aria-label="主导航">
          <Link
            href="/"
            className={
              "nav-item" + (activePage === "learning" ? " active" : "")
            }
            aria-current={activePage === "learning" ? "page" : undefined}
            onClick={(event) => {
              if (busy || onHome) event.preventDefault();
              if (!busy) onHome?.();
            }}
            aria-disabled={busy}
          >
            <Icon
              name="pin"
              size={17}
            />
            场景学习
          </Link>
          <Link
            href="/favorites"
            className={
              "nav-item" + (activePage === "favorites" ? " active" : "")
            }
            aria-current={activePage === "favorites" ? "page" : undefined}
            onClick={(event) => {
              if (busy || onFavorites) event.preventDefault();
              if (!busy) onFavorites?.();
            }}
            aria-disabled={busy}
          >
            <Icon
              name="bookmark"
              size={17}
            />
            收藏表达
          </Link>
          <button
            className="nav-item"
            disabled
            title="复习与错题将在后续版本开放"
          >
            <Icon
              name="book"
              size={18}
            />
            错题本 <span className="soon-label">即将开放</span>
          </button>
        </nav>
      </header>
      {activePage !== "favorites" && (
        <section
          className="jane-hero"
          aria-label="Jane 的引导"
        >
          <div className="hero-cloud cloud-one" />
          <div className="hero-cloud cloud-two" />
          <span className="hero-star star-one">✦</span>
          <span className="hero-star star-two">✧</span>
          <JaneAvatar />
          <div className="speech-bubble">
            <span
              className={"jane-label" + (compact ? "" : " jane-home-label")}
            >
              {label ?? "Jane · 你的旅行搭子"}
              {compact && <span>✦</span>}
            </span>
            <h1>{title}</h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
        </section>
      )}
      {children}
      <footer className="app-footer">
        <Icon
          name="heart"
          size={13}
        />{" "}
        每一句小小的练习，都是下一次旅行的底气。
        <span>TripTalk · 和 Jane 一起出发</span>
      </footer>
    </div>
  );
}

function BrandLink({ busy, onHome }: { busy: boolean; onHome?: () => void }) {
  const brand = (
    <>
      <Icon
        name="case"
        size={27}
      />
      TripTalk<span className="brand-dot">.</span>
    </>
  );
  // 提交中不可离开；对话页先处理草稿确认，首页则使用普通链接。
  if (busy) return <span className="brand">{brand}</span>;
  if (onHome) {
    return (
      <button
        onClick={onHome}
        className="brand brand-button"
        aria-label="TripTalk 首页"
      >
        {brand}
      </button>
    );
  }
  return (
    <Link
      href="/"
      className="brand"
      aria-label="TripTalk 首页"
    >
      {brand}
    </Link>
  );
}
