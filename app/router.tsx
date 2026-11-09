import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
} from "react";
import { flushSync } from "react-dom";
import { prepareRoute } from "./route-pages";

const subscribe = (notify: () => void) => {
  window.addEventListener("popstate", notify);
  window.addEventListener("hashchange", notify);
  return () => {
    window.removeEventListener("popstate", notify);
    window.removeEventListener("hashchange", notify);
  };
};
const getLocation = () =>
  window.location.pathname + window.location.search + window.location.hash;
export function useLocation(): string {
  return useSyncExternalStore(subscribe, getLocation, () => "/");
}
export function usePathname(): string {
  return useLocation().split(/[?#]/)[0];
}

let navigationId = 0;
let pendingPath: string | null = null;
const pendingListeners = new Set<() => void>();
function setPending(path: string | null) {
  pendingPath = path;
  pendingListeners.forEach(notify => notify());
}
function cancelPending() {
  navigationId++;
  setPending(null);
}
// Browser Back/Forward always wins over a still-loading explicit navigation.
if (typeof window !== "undefined") {
  window.addEventListener("popstate", cancelPending);
  window.addEventListener("hashchange", cancelPending);
}
const subscribePending = (notify: () => void) => {
  pendingListeners.add(notify);
  return () => { pendingListeners.delete(notify); };
};
export function usePendingPathname() {
  return useSyncExternalStore(subscribePending, () => pendingPath, () => null);
}
export function navigate(path: string, replace = false) {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin)
    throw new Error("Application navigation must stay on this origin.");
  const next = url.pathname + url.search + url.hash;
  const id = ++navigationId;
  if (getLocation() === next) { setPending(null); return; }
  const previousPath = window.location.pathname;
  const commit = () => {
    if (id !== navigationId) return;
    // Keep old content/scroll until the destination can render synchronously.
    // Flush the external location store before resetting scroll, not a frame later.
    flushSync(() => {
      window.history[replace ? "replaceState" : "pushState"]({}, "", next);
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    if (previousPath !== url.pathname) window.scrollTo({ top: 0, behavior: "instant" });
  };
  const preparation = prepareRoute(url.pathname);
  if (!preparation) { commit(); return; }
  setPending(url.pathname);
  // Import failures render the existing route error boundary; never strand the
  // selection or leave an unhandled rejection. A newer intent cancels both paths.
  return preparation.then(commit, commit);
}
export function useRouter() {
  const push = useCallback((path: string) => navigate(path), []);
  const replace = useCallback((path: string) => navigate(path, true), []);
  return useMemo(() => ({ push, replace }), [push, replace]);
}

/** Internal anchors preserve the session, while modified clicks retain normal browser behavior. */
export function AppLink({
  href = "/",
  onClick,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          props.download ||
          (props.target && props.target !== "_self")
        )
          return;
        const url = new URL(href, location.href);
        if (url.origin !== location.origin) return;
        event.preventDefault();
        navigate(url.pathname + url.search + url.hash);
      }}
    />
  );
}
