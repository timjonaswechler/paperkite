import { requireBusiness } from "../api";

function imageSize(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b))
    return { width: view.getUint32(16), height: view.getUint32(20) };
  requireBusiness(
    bytes[0] === 255 && bytes[1] === 216,
    "Bitte eine PNG- oder JPEG-Datei auswählen.",
  );
  let at = 2;
  while (at + 4 <= bytes.length) {
    requireBusiness(bytes[at++] === 255, "Ungültiges JPEG-Bild.");
    while (bytes[at] === 255) at++;
    const marker = bytes[at++];
    if (marker === 1 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) continue;
    requireBusiness(
      marker !== 0xda && marker !== 0xd9 && at + 2 <= bytes.length,
      "Ungültiges JPEG-Bild.",
    );
    const size = view.getUint16(at);
    requireBusiness(size >= 2 && at + size <= bytes.length, "Unvollständiges JPEG-Bild.");
    if (
      marker !== undefined &&
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    ) {
      requireBusiness(size >= 8, "Ungültiger JPEG-Bildkopf.");
      return { height: view.getUint16(at + 3), width: view.getUint16(at + 5) };
    }
    at += size;
  }
  throw Error("Bildgröße konnte nicht gelesen werden.");
}
export function signatureCanvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  const ctx = canvas.getContext("2d");
  requireBusiness(ctx, "Zeichenfläche nicht verfügbar.");
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let ink = false;
  for (let at = 0; at < pixels.length; at += 4)
    if (pixels[at + 3]! > 16 && Math.min(pixels[at]!, pixels[at + 1]!, pixels[at + 2]!) < 245) {
      ink = true;
      break;
    }
  requireBusiness(
    ink,
    "Die Unterschrift ist leer. Bitte zeichnen oder ein Bild mit sichtbarer Unterschrift hochladen.",
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => {
      if (!blob) reject(Error("Unterschrift konnte nicht gespeichert werden."));
      else if (blob.size > 1024 * 1024)
        reject(Error("Unterschrift maximal 1 MiB nach Umwandlung."));
      else resolve(blob);
    }, "image/png"),
  );
}
export async function prepareSignatureImage(file: File): Promise<Blob> {
  requireBusiness(file.size > 0 && file.size <= 8 * 1024 * 1024, "Bilddatei maximal 8 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const size = imageSize(bytes);
  requireBusiness(
    size.width > 0 && size.height > 0 && size.width * size.height <= 16_000_000,
    "Bild maximal 16 Megapixel. Bitte die Unterschrift zuschneiden.",
  );
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 2048 / bitmap.width, 1024 / bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    requireBusiness(ctx, "Bildverarbeitung nicht verfügbar.");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await signatureCanvasBlob(canvas);
  } finally {
    bitmap.close();
  }
}
