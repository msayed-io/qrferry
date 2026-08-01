import Link from "next/link";

export function AppHeader({ active }: { active: "send" | "scan" }) {
  return (
    <header className="site-header">
      <Link className="wordmark" href="/" aria-label="QRFerry الرئيسية">
        <span className="brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <span>QRFerry</span>
      </Link>
      <nav className="mode-switch" aria-label="وضع النقل">
        <Link className={active === "send" ? "active" : ""} href="/">
          إرسال
        </Link>
        <Link className={active === "scan" ? "active" : ""} href="/scan">
          مسح
        </Link>
      </nav>
      <span className="local-badge">
        <span aria-hidden="true" />
        من جهاز إلى جهاز
      </span>
    </header>
  );
}
