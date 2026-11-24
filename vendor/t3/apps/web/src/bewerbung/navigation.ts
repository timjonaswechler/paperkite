const guards = new Set<() => boolean>();
export function registerNavigationGuard(next: () => boolean) {
  guards.add(next);
  return () => {
    guards.delete(next);
  };
}
export function confirmNavigation() {
  for (const guard of guards) if (!guard()) return false;
  return true;
}
