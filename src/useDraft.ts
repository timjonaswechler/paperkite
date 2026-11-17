import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./api";

// A remounted application must wait for its previous instance's final autosave.
const pendingDrafts = new Map<string, { text: string; write: Promise<void> }>();
const blockedDrafts = new Set<string>();

export async function prepareDraftDeletion(id: string) {
  blockedDrafts.add(id);
  await pendingDrafts.get(id)?.write.catch(() => {});
  return (deleted: boolean) => {
    if (deleted) pendingDrafts.delete(id);
    else {
      blockedDrafts.delete(id);
      window.dispatchEvent(
        new CustomEvent("bewerbung:draft-resume", { detail: id }),
      );
    }
  };
}

export function useDraft(id: string) {
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const state = useRef({
    text: "",
    dirty: false,
    mounted: true,
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
    writes: Promise.resolve(),
    pendingWrites: 0,
    sending: false,
  });
  function persist() {
    const current = state.current;
    clearTimeout(current.timer);
    current.timer = undefined;
    if (!current.dirty || current.sending || blockedDrafts.has(id)) return;
    current.dirty = false;
    const value = current.text;
    current.pendingWrites++;
    const pending = { text: value, write: Promise.resolve() };
    current.writes = current.writes
      .catch(() => {})
      .then(async () => {
        try {
          if (blockedDrafts.has(id)) {
            current.dirty = true;
            return;
          }
          const body = { text: value };
          // Small draft writes survive a reload; larger writes keep the unload warning instead.
          await api(
            `/applications/${id}/draft`,
            "PUT",
            body,
            undefined,
            new Blob([JSON.stringify(body)]).size < 60_000,
          );
          if (pendingDrafts.get(id) === pending) pendingDrafts.delete(id);
          if (current.mounted) setError("");
        } catch (e) {
          current.dirty = true;
          if (current.mounted)
            setError(`Entwurf nicht gespeichert: ${errorMessage(e)}`);
          throw e;
        } finally {
          current.pendingWrites--;
        }
      });
    pending.write = current.writes;
    pendingDrafts.set(id, pending);
    void current.writes.catch(() => {});
  }
  useEffect(() => {
    const current = state.current;
    current.mounted = true;
    const controller = new AbortController();
    void (async () => {
      await pendingDrafts.get(id)?.write.catch(() => {});
      if (controller.signal.aborted) return;
      const draft = await api<{ text: string }>(
        `/applications/${id}/draft`,
        "GET",
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const unsaved = pendingDrafts.get(id);
      if (!current.dirty) {
        current.text = unsaved?.text ?? draft.text;
        current.dirty = Boolean(unsaved);
        setText(current.text);
      }
      setReady(true);
      setError(
        unsaved
          ? "Entwurf noch nicht gespeichert. Bitte erneut versuchen."
          : "",
      );
    })().catch((e) => {
      if (!controller.signal.aborted)
        setError(`Entwurf konnte nicht geladen werden: ${errorMessage(e)}`);
    });
    return () => {
      controller.abort();
      current.mounted = false;
      persist();
    };
  }, [id, reload]);
  useEffect(() => {
    const flush = () => persist();
    const resume = (event: Event) => {
      if ((event as CustomEvent<string>).detail === id) persist();
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (state.current.dirty || state.current.pendingWrites) {
        persist();
        event.preventDefault();
      }
    };
    window.addEventListener("bewerbung:draft-resume", resume);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("bewerbung:draft-resume", resume);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", warn);
    };
  }, [id]);
  function change(value: string) {
    const current = state.current;
    current.text = value;
    current.dirty = true;
    setText(value);
    clearTimeout(current.timer);
    current.timer = setTimeout(persist, 400);
  }
  async function prepareSend() {
    const current = state.current;
    clearTimeout(current.timer);
    current.timer = undefined;
    current.sending = true;
    // A completed old PUT must never race the prompt endpoint's accepted-send draft clear.
    await current.writes.catch(() => {});
  }
  function sent() {
    const current = state.current;
    current.sending = false;
    current.dirty = false;
    current.text = "";
    pendingDrafts.delete(id);
    if (current.mounted) {
      setText("");
      setError("");
    }
  }
  function sendFailed() {
    state.current.sending = false;
    persist();
  }
  return {
    text,
    ready,
    error,
    change,
    prepareSend,
    sent,
    sendFailed,
    retry: () => {
      if (ready) persist();
      else setReload((n) => n + 1);
    },
  };
}
