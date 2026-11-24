from pathlib import Path
import subprocess
from PIL import Image


def on_white(image):
    return Image.alpha_composite(Image.new('RGBA', image.size, 'white'), image).convert('RGB').tobytes()


with Image.open('/source/applicant-signature.png') as source:
    assert 0 < source.width <= 2048 and 0 < source.height <= 1024
    reference = source.convert('RGBA')
expected = on_white(reference)
expected_alpha = reference.getchannel('A').tobytes()
listing = subprocess.run(['pdfimages', '-list', '/input/document.pdf'], check=True, capture_output=True, text=True)
rows = [parts for line in listing.stdout.splitlines() if len(parts := line.split()) >= 12 and parts[0].isdigit()]
subprocess.run(['pdfimages', '-png', '/input/document.pdf', '/tmp/signature-image'], check=True, capture_output=True)
for index, row in enumerate(rows):
    if row[2] != 'image':
        continue
    filename = Path('/tmp') / f'signature-image-{int(row[1]):03}.png'
    if not filename.is_file():
        continue
    with Image.open(filename) as source:
        if source.size != reference.size:
            continue
        image = source.convert('RGBA')
    # PNG transparency is usually a separate PDF soft mask, not part of the extracted RGB plane.
    if index + 1 < len(rows):
        mask = rows[index + 1]
        if mask[2] == 'smask' and mask[0] == row[0] and mask[10:12] == row[10:12]:
            with Image.open(Path('/tmp') / f'signature-image-{int(mask[1]):03}.png') as alpha:
                if alpha.size != image.size:
                    continue
                image.putalpha(alpha.convert('L'))
    if image.getchannel('A').tobytes() == expected_alpha and on_white(image) == expected:
        print('Gespeicherte Unterschriftsgrafik im PDF nachgewiesen.')
        break
else:
    raise SystemExit('Die vorgesehene Unterschriftsgrafik wurde im PDF nicht wiedergefunden.')
