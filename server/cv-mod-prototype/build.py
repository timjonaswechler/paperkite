import json, os, pathlib, shutil, subprocess, sys

shutil.copytree('/input', '/work/input')
root = pathlib.Path('/work/input')
config = json.loads((root / 'mod.json').read_text())
assert config['format'] == 'bewerbung-cv-mod-prototype-v1'
engine = config['engine']
assert engine in ('lualatex', 'pdflatex')
if engine == 'pdflatex':
    cover = json.loads((root / 'cover-mod.json').read_text())
    assert cover['format'] == 'bewerbung-cover-mod-v1'
    assert cover['engine'] == engine and cover['entrypoint'] == config['entrypoint']
    assert (root / 'letter-data.tex').is_file()
if engine == 'pdflatex' or config.get('applicant'):
    os.environ['TEXINPUTS'] = str(root) + ':' + os.environ.get('TEXINPUTS', '')
entry = (root / config['entrypoint']).resolve()
assert entry.is_relative_to(root) and entry.suffix == '.tex'
os.environ['CV_DATA_FILE'] = str(root / 'cv-data.lua')
os.environ['LETTER_DATA_FILE'] = str(root / 'cv-data.lua')
os.environ['APPLICANT_DATA_FILE'] = str(root / 'applicant-data.lua')
os.environ['HOME'] = '/tmp'
output = pathlib.Path('/work/output')
output.mkdir()
for _ in range(2):
    result = subprocess.run([engine, '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-output-directory=' + str(output), entry.name], cwd=entry.parent)
    if result.returncode:
        sys.exit(result.returncode)
pdf = output / (entry.stem + '.pdf')
assert pdf.is_file() and not pdf.is_symlink() and 0 < pdf.stat().st_size <= 32 * 1024 * 1024
shutil.copyfile(pdf, '/out/document.pdf')
