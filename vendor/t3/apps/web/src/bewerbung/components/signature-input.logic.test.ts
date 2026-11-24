import { describe, expect, it } from "vite-plus/test";
import { prepareSignatureImage, signatureCanvasBlob } from "./signature-input";

describe("signature input limits", () => {
  it("rejects non-images, truncated JPEG and excessive dimensions before bitmap decoding", async () => {
    const png = new Uint8Array(24);
    png.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const size = new DataView(png.buffer);
    size.setUint32(16, 5000);
    size.setUint32(20, 4000);
    const cases = [
      [new File(["<svg></svg>"], "signature.png"), /PNG- oder JPEG/],
      [
        new File([new Uint8Array([255, 216, 255, 192, 0, 30])], "broken.jpg"),
        /Unvollständiges JPEG/,
      ],
      [new File([png], "large.png"), /16 Megapixel/],
      [
        new File([new Uint8Array([255, 216, 255, 192, 0, 8, 8, 3, 232, 156, 64, 1])], "large.jpg"),
        /16 Megapixel/,
      ],
      [new File([new Uint8Array(8 * 1024 * 1024 + 1)], "large.png"), /8 MiB/],
    ] as const;
    for (const [file, message] of cases)
      await expect(prepareSignatureImage(file)).rejects.toThrow(message);
  });

  it("rejects white/transparent drawings, accepts visible ink and bounds the encoded size", async () => {
    function canvas(pixels: number[], bytes = 1): HTMLCanvasElement {
      return {
        width: 1,
        height: 1,
        getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(pixels) }) }),
        toBlob: (callback: BlobCallback) =>
          callback(new Blob([new Uint8Array(bytes)], { type: "image/png" })),
      } as unknown as HTMLCanvasElement;
    }
    for (const pixels of [
      [255, 255, 255, 255],
      [0, 0, 0, 0],
    ])
      expect(() => signatureCanvasBlob(canvas(pixels))).toThrow(/Unterschrift ist leer/);
    expect((await signatureCanvasBlob(canvas([20, 30, 40, 255]))).type).toBe("image/png");
    await expect(signatureCanvasBlob(canvas([20, 30, 40, 255], 1024 * 1024 + 1))).rejects.toThrow(
      /1 MiB/,
    );
  });
});
