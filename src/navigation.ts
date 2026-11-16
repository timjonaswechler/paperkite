// The advanced source editor can veto application navigation without leaking its draft into another app.
let guard: (() => boolean) | undefined;
export function registerNavigationGuard(next: () => boolean) {
  guard = next;
  return () => {
    if (guard === next) guard = undefined;
  };
}
export function confirmNavigation() {
  return guard?.() ?? true;
}
