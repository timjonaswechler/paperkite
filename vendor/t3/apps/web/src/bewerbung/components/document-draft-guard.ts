import { useEffect } from "react";
import { registerNavigationGuard } from "../navigation";

export function useDocumentDraftGuard(dirty: boolean) {
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- protects owned unsaved input when the router attempts navigation
  useEffect(
    () => registerNavigationGuard(() => !dirty || confirm("Ungespeicherte Änderungen verwerfen?")),
    [dirty],
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- protects owned unsaved input before a browser reload
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}
