import { useCallback, useSyncExternalStore } from 'react';

const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  return () => window.removeEventListener('popstate', notify);
};
const getPath = () => window.location.pathname;

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPath, () => '/');
}

export function useRouter() {
  const push = useCallback((path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  }, []);
  return { push };
}
