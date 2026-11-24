import argparse
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageChops

parser = argparse.ArgumentParser(description='Exact pinned-raster comparison, never a fuzzy layout score.')
parser.add_argument('--reference', default='/reference/document.pdf')
parser.add_argument('--candidate', default='/candidate/document.pdf')
parser.add_argument('--output', default='/out')
args = parser.parse_args()
out = Path(args.output)
out.mkdir(parents=True, exist_ok=True)
for label, pdf in [('reference', args.reference), ('candidate', args.candidate)]:
    subprocess.run(['pdftoppm', '-r', '150', '-aa', 'yes', '-aaVector', 'yes', '-png', pdf, str(out / label)], check=True, capture_output=True, timeout=60)
    fonts = subprocess.run(['pdffonts', pdf], check=True, capture_output=True, text=True)
    (out / f'{label}-fonts.txt').write_text(fonts.stdout)
reference = sorted(out.glob('reference-*.png'))
candidate = sorted(out.glob('candidate-*.png'))
report = {'dpi': 150, 'pixelTolerance': 0, 'referencePages': len(reference), 'candidatePages': len(candidate), 'pages': []}
equal = len(reference) == len(candidate) and bool(reference)
for index, (a, b) in enumerate(zip(reference, candidate), start=1):
    with Image.open(a) as left, Image.open(b) as right:
        same = left.size == right.size
        box = None
        if same:
            delta = ImageChops.difference(left.convert('RGB'), right.convert('RGB'))
            box = delta.getbbox()
            same = box is None
            if not same:
                delta.save(out / f'difference-{index}.png')
        report['pages'].append({'page': index, 'sameSize': left.size == right.size, 'pixelIdentical': same, 'differenceBounds': box})
        equal = equal and same
report['result'] = 'identical' if equal else 'different'
(out / 'comparison.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report))
raise SystemExit(0 if equal else 1)
