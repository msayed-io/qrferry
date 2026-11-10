/** Five masked blur radii approximate a continuous radius field. No opaque
 * toolbar plate, scene duplication, event interception, or animated filter. */
export function ProgressiveBlur({ edge = "top" }: { edge?: "top" | "bottom" }) {
  return <div className={`progressive-blur progressive-blur-${edge}`} aria-hidden="true">
    {[2, 4, 8, 16, 24].map(radius => <i key={radius} />)}
  </div>;
}

export function BackChevron() {
  return <svg className="back-chevron" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>;
}
