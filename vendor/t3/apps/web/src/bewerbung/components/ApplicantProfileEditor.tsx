import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { useApplications } from "../ApplicationsProvider";
import { api, base, errorMessage, requireBusiness } from "../api";
import type { ApplicantProfile, Settings, SignatureInfo } from "../shared/api";
import { applicantTextFields, sameApplicantProfile } from "../shared/applicant-profile";
import { ErrorNotice, Field } from "./Controls";
import { useDocumentDraftGuard } from "./document-draft-guard";
import { prepareSignatureImage, signatureCanvasBlob } from "./signature-input";

const fields = [
  ["firstName", "Vorname(n)", "given-name"],
  ["lastName", "Nachname", "family-name"],
  ["street", "Straße und Hausnummer", "address-line1"],
  ["addressLine2", "Adresszusatz", "address-line2"],
  ["postalCode", "Postleitzahl", "postal-code"],
  ["city", "Ort", "address-level2"],
  ["country", "Land (optional)", "country-name"],
] as const;

export function ApplicantProfileEditor({
  settings,
  onSaved,
  onClose,
  focusSignature = false,
}: {
  settings: Settings;
  onSaved?: (profile: ApplicantProfile) => void | Promise<void>;
  onClose?: () => void;
  focusSignature?: boolean;
}) {
  const app = useApplications();
  const [draft, setDraft] = useState(() => ({ ...settings.applicantProfile }));
  const [baseline, setBaseline] = useState(() => ({ ...settings.applicantProfile }));
  const [signatureMode, setSignatureMode] = useState<"keep" | "replace" | "remove">("keep");
  const [pendingImage, setPendingImage] = useState<Blob | null>(null);
  const [preview, setPreview] = useState("");
  const [drawing, setDrawing] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const signatureRef = useRef<HTMLElement>(null);
  const drawingHelpId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<number | null>(null);
  const operation = useRef(0);
  const busyRef = useRef(false);
  const ownedUrl = useRef("");
  const dirty =
    !sameApplicantProfile(draft, baseline) || signatureMode !== "keep" || (drawing && drawn);
  const conflict = !sameApplicantProfile(settings.applicantProfile, baseline);
  useDocumentDraftGuard(dirty || busy);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reveals the signature controls after the user explicitly requested a missing signature
  useEffect(() => {
    if (focusSignature) signatureRef.current?.scrollIntoView({ block: "start" });
  }, [focusSignature]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- releases the owned local image preview and invalidates pending image decoding on unmount
  useEffect(
    () => () => {
      operation.current++;
      if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    },
    [],
  );
  function changeImage(blob: Blob | null) {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = blob ? URL.createObjectURL(blob) : "";
    setPreview(ownedUrl.current);
    setPendingImage(blob);
  }
  async function selectImage(file: File | undefined) {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const token = ++operation.current;
    try {
      const blob = await prepareSignatureImage(file);
      if (token === operation.current) {
        changeImage(blob);
        setSignatureMode("replace");
        setDrawing(false);
        setDrawn(false);
      }
    } catch (e) {
      if (token === operation.current) setError(errorMessage(e));
    } finally {
      if (token === operation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget,
      box = canvas.getBoundingClientRect();
    return [
      ((event.clientX - box.left) * canvas.width) / box.width,
      ((event.clientY - box.top) * canvas.height) / box.height,
    ] as const;
  }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    if (busy || pointer.current !== null || (event.pointerType === "mouse" && event.button !== 0))
      return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointer.current = event.pointerId;
    const ctx = event.currentTarget.getContext("2d");
    if (!ctx) return;
    const [x, y] = point(event);
    ctx.strokeStyle = "#111111";
    ctx.fillStyle = "#111111";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x, y);
    setDrawn(true);
    setNotice("");
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== event.pointerId || busy) return;
    event.preventDefault();
    const ctx = event.currentTarget.getContext("2d");
    if (!ctx) return;
    ctx.lineTo(...point(event));
    ctx.stroke();
  }
  function stop(event: PointerEvent<HTMLCanvasElement>) {
    if (pointer.current !== event.pointerId) return;
    pointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function clearDrawing() {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    pointer.current = null;
    setDrawn(false);
  }
  async function save() {
    if (busyRef.current) return;
    if (drawing && !drawn) {
      setError(
        "Die Zeichenfläche ist noch leer. Bitte zeichnen, ein Bild hochladen oder die Zeichnung verwerfen.",
      );
      return;
    }
    if (!dirty) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      requireBusiness(
        !conflict,
        "Das Profil wurde inzwischen geändert. Bitte den gespeicherten Stand neu laden; deine Eingaben bleiben bis dahin erhalten.",
      );
      const next = { ...draft };
      for (const key of applicantTextFields) next[key] = next[key].trim();
      let image = signatureMode === "replace" ? pendingImage : null;
      if (drawing && drawn && canvasRef.current)
        image = await signatureCanvasBlob(canvasRef.current);
      if (image) {
        const response = await fetch(base + "/applicant-signatures", {
          method: "POST",
          headers: { "Content-Type": "image/png", "X-Bewerbung-Request": "1" },
          body: image,
        });
        const info = (await response.json()) as SignatureInfo & { error?: string };
        requireBusiness(response.ok, info.error || "Unterschrift konnte nicht gespeichert werden.");
        next.signatureId = info.id;
      } else if (signatureMode === "remove") next.signatureId = null;
      await app.saveSettings((current) => {
        requireBusiness(
          sameApplicantProfile(current.applicantProfile, baseline),
          "Das Profil wurde inzwischen geändert. Bitte den gespeicherten Stand neu laden.",
        );
        return { applicantProfile: next };
      });
      setBaseline(next);
      setDraft(next);
      setSignatureMode("keep");
      changeImage(null);
      clearDrawing();
      setDrawing(false);
      setNotice(
        "Bewerberprofil gespeichert. Bestehende Bewerbungen behalten ihren Datenstand bis zur bewussten Übernahme.",
      );
      await onSaved?.(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function reload() {
    if (
      busyRef.current ||
      (dirty &&
        !confirm("Ungespeicherte Profiländerungen verwerfen und den gespeicherten Stand laden?"))
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await app.refreshAll();
      const fresh = await api<Settings>("/settings");
      setDraft(fresh.applicantProfile);
      setBaseline(fresh.applicantProfile);
      setSignatureMode("keep");
      changeImage(null);
      clearDrawing();
      setDrawing(false);
      setNotice("");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  const imageUrl =
    signatureMode === "replace"
      ? preview
      : signatureMode === "keep" && draft.signatureId
        ? `${base}/applicant-signatures/${draft.signatureId}`
        : "";
  return (
    <form
      className="space-y-4"
      aria-label="Bewerberprofil bearbeiten"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Einmal erfassen und über Profilvariablen in unterstützten Lebenslauf- und
        Anschreiben-Layouts einsetzen. Der vollständige Name wird auch für Dateinamen verwendet.
      </p>
      <ErrorNotice
        error={
          error ||
          (conflict
            ? "Das gespeicherte Profil hat sich geändert. Deine Eingaben wurden nicht ersetzt; bitte den gespeicherten Stand neu laden."
            : "")
        }
        onClose={() => setError("")}
      />
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {fields.map(([key, label, autocomplete]) => (
          <Field key={key} label={label}>
            <Input
              aria-label={label}
              autoComplete={autocomplete}
              maxLength={key === "firstName" || key === "lastName" ? 120 : 200}
              disabled={busy}
              value={draft[key]}
              onChange={(event) => {
                setDraft({ ...draft, [key]: event.target.value });
                setNotice("");
              }}
            />
          </Field>
        ))}
      </div>
      <section ref={signatureRef} className="min-w-0 space-y-3" aria-label="Unterschrift verwalten">
        <h3 className="text-sm font-medium">Unterschrift</h3>
        <p className="text-xs text-muted-foreground">
          PNG oder JPEG bis 8 MiB / 16 Megapixel auswählen oder selbst zeichnen. Gespeichert wird
          eine geprüfte PNG bis 1 MiB und 2048 × 1024 Pixel. Nur Layouts mit vorgesehener
          Unterschrift verwenden die Grafik.
        </p>
        {imageUrl && (
          <div className="max-w-md">
            <img
              src={imageUrl}
              alt={
                signatureMode === "replace"
                  ? "Neue Unterschrift, noch nicht gespeichert"
                  : "Gespeicherte Unterschrift"
              }
              className="max-h-28 max-w-full rounded-md border bg-white p-2"
            />
          </div>
        )}
        {signatureMode === "remove" && (
          <p role="status" className="text-xs text-muted-foreground">
            Die Unterschrift wird beim Speichern aus dem Profil entfernt. Bestehende Bewerbungen
            behalten ihre bisherige Unterschrift.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
          >
            Unterschrift hochladen
          </Button>
          <Button type="button" variant="outline" disabled={busy} onClick={() => setDrawing(true)}>
            Unterschrift zeichnen
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy || (!draft.signatureId && signatureMode !== "replace" && !drawn)}
            onClick={() => {
              changeImage(null);
              setSignatureMode("remove");
              clearDrawing();
              setDrawing(false);
              setNotice("");
            }}
          >
            Unterschrift entfernen
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,.png,.jpg,.jpeg"
            aria-label="Unterschriftsbild auswählen"
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              void selectImage(file);
            }}
          />
        </div>
        {drawing && (
          <div className="max-w-xl space-y-2">
            <p id={drawingHelpId} className="text-xs text-muted-foreground">
              Mit Maus oder Touch zeichnen. Alternativ kannst du über „Unterschrift hochladen“ per
              Tastatur eine Bilddatei auswählen. Die Zeichnung wird mit „Profil speichern“
              übernommen.
            </p>
            <canvas
              ref={canvasRef}
              width={1000}
              height={300}
              role="application"
              tabIndex={0}
              aria-label="Unterschrift zeichnen"
              aria-describedby={drawingHelpId}
              className="w-full touch-none rounded-md border bg-white"
              onPointerDown={start}
              onPointerMove={move}
              onPointerUp={stop}
              onPointerCancel={stop}
              onLostPointerCapture={() => {
                pointer.current = null;
              }}
            />
            {!drawn && (
              <p role="status" className="text-xs text-muted-foreground">
                Die Zeichenfläche ist noch leer. Zuerst zeichnen oder die Zeichnung verwerfen.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={busy || !drawn}
                onClick={clearDrawing}
              >
                Zeichenfläche leeren
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (drawn && !confirm("Ungespeicherte Zeichnung verwerfen?")) return;
                  clearDrawing();
                  setDrawing(false);
                  setError("");
                }}
              >
                Zeichnung verwerfen
              </Button>
            </div>
          </div>
        )}
      </section>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !dirty || conflict || (drawing && !drawn)}>
          {busy ? "Profil wird gespeichert…" : "Profil speichern"}
        </Button>
        <Button type="button" variant="ghost" disabled={busy} onClick={() => void reload()}>
          Gespeicherten Stand neu laden
        </Button>
      </div>
      {onClose && (
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            if (!dirty || confirm("Ungespeicherte Profiländerungen verwerfen?")) onClose();
          }}
        >
          Profilbearbeitung schließen
        </Button>
      )}
      <p role="status" className="text-xs text-muted-foreground">
        {notice}
      </p>
    </form>
  );
}
