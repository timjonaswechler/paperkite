"""Offline, bounded PDF composition. Inputs read-only, outputs are always new files."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import warnings

import img2pdf
from PIL import Image

Image.MAX_IMAGE_PIXELS = 30_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)
LIMIT = 180 * 1024 * 1024


def deadline(_signum, _frame):
    # PID 1 exits even if a native subprocess hangs; Docker ends the whole container.
    os._exit(124)


signal.signal(signal.SIGALRM, deadline)
signal.alarm(110)


def run(args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45)
    if result.returncode != 0:
        raise ValueError("PDF ist nicht lesbar, kennwortgeschützt oder die Seitenwahl ist ungültig. " + result.stderr.decode("utf-8", "replace")[-800:])
    return result.stdout.decode("utf-8", "replace").strip()


def count_pages(file):
    count = int(run(["qpdf", "--warning-exit-0", "--show-npages", str(file)]))
    if not 0 < count <= 500:
        raise ValueError("Höchstens 500 PDF-Seiten erlaubt")
    return count


def selected_pages(specification, count):
    if not specification:
        return count
    if len(specification) > 200 or not re.fullmatch(r"[1-9]\d*(?:-[1-9]\d*)?(?:,[1-9]\d*(?:-[1-9]\d*)?)*", specification):
        raise ValueError("Seitenwahl wie 1-3,5 angeben")
    total = 0
    for part in specification.split(","):
        bounds = [int(value) for value in part.split("-")]
        if any(value > count for value in bounds):
            raise ValueError("Ausgewählte Seite existiert nicht")
        total += abs(bounds[-1] - bounds[0]) + 1
    return total


def main():
    source = Path("/input")
    plan = json.loads((source / "plan.json").read_text())
    items, compression = plan["items"], plan["compression"]
    if not isinstance(items, list) or not 1 <= len(items) <= 40 or compression not in ("lossless", "compact"):
        raise ValueError("Ungültige PDF-Zusammenstellung")
    args = ["qpdf", "--warning-exit-0", "--empty", "--pages"]
    expected_pages = 0
    original_total = 0
    for index, item in enumerate(items):
        name = item["filename"]
        if not re.fullmatch(r"\d{3}\.(pdf|png|jpg)", name):
            raise ValueError("Ungültige Eingabedatei")
        file = source / name
        if file.is_symlink() or file.stat().st_size != item["bytes"]:
            raise ValueError("Eingabedatei verändert")
        original_total += item["bytes"]
        if hashlib.file_digest(file.open("rb"), "sha256").hexdigest() != item["sha256"]:
            raise ValueError("Eingabedatei beschädigt")
        if item["mime"] != "application/pdf":
            if item.get("pages", "1") != "1":
                raise ValueError("Ein Bild hat genau eine Seite")
            with Image.open(file) as image:
                if image.width * image.height > 30_000_000 or getattr(image, "n_frames", 1) != 1:
                    raise ValueError("Bild zu groß oder mehrseitig")
                image.verify()
            converted = Path(f"/tmp/image-{index}.pdf")
            a4 = (img2pdf.mm_to_pt(210), img2pdf.mm_to_pt(297))
            with converted.open("wb") as output:
                img2pdf.convert(str(file), outputstream=output, layout_fun=img2pdf.get_layout_fun(a4, auto_orient=True), rotation=img2pdf.Rotation.ifvalid)
            file = converted
        pages = count_pages(file)
        specification = item.get("pages", "")
        expected_pages += selected_pages(specification, pages)
        if expected_pages > 500 or original_total > LIMIT:
            raise ValueError("Zusammenstellung zu groß")
        args += [str(file), specification or "1-z"]
    merged = Path("/tmp/merged.pdf")
    args += ["--", "--object-streams=generate", "--recompress-flate", "--compression-level=9", str(merged)]
    run(args)
    chosen, note = merged, None
    if compression == "compact":
        compact = Path("/tmp/compact.pdf")
        run(["gs", "-q", "-dSAFER", "-dBATCH", "-dNOPAUSE", "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.7", "-dAutoRotatePages=/None",
             "-dDetectDuplicateImages=true", "-dCompressFonts=true", "-dSubsetFonts=true", "-dEmbedAllFonts=true",
             "-dDownsampleColorImages=true", "-dColorImageDownsampleType=/Bicubic", "-dColorImageResolution=150", "-dColorImageDownsampleThreshold=1.0",
             "-dDownsampleGrayImages=true", "-dGrayImageDownsampleType=/Bicubic", "-dGrayImageResolution=150", "-dGrayImageDownsampleThreshold=1.0",
             "-dDownsampleMonoImages=true", "-dMonoImageResolution=300", "-dMonoImageDownsampleThreshold=1.0", "-dJPEGQ=80",
             "-sOutputFile=" + str(compact), str(merged)])
        if compact.stat().st_size < merged.stat().st_size:
            chosen = compact
        else:
            note = "Kompakte Ausgabe war nicht kleiner; verlustfreie Zusammenstellung beibehalten."
    # A single complete PDF may already be optimally compressed; never inflate it pointlessly.
    if len(items) == 1 and items[0]["mime"] == "application/pdf" and not items[0].get("pages"):
        original = source / items[0]["filename"]
        if original.stat().st_size <= chosen.stat().st_size:
            chosen = original
            note = "Keine kleinere Ausgabe erzielt; unverändertes Original verwendet."
    if chosen.stat().st_size > LIMIT or count_pages(chosen) != expected_pages:
        raise ValueError("Ergebnis zu groß oder Seitenzahl unerwartet")
    shutil.copyfile(chosen, "/out/result.pdf")
    print(json.dumps({"pages": expected_pages, **({"note": note} if note else {})}))


try:
    main()
except Exception as error:
    print(str(error)[:2000], file=sys.stderr)
    sys.exit(1)
