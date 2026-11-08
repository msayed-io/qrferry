import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
} from "react";

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

export function navigate(path: string, replace = false) {
  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin)
    throw new Error("Application navigation must stay on this origin.");
  const next = url.pathname + url.search + url.hash;
  if (getLocation() === next) return;
  window.history[replace ? "replaceState" : "pushState"]({}, "", next);
  window.dispatchEvent(new PopStateEvent("popstate"));
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
        window.scrollTo({ top: 0 });
      }}
    />
  );
}
