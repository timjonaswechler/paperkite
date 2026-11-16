import os, pathlib, shutil, subprocess, sys
kind, profile = sys.argv[1:]
assert kind in ('cv', 'cover')
shutil.copytree('/input', '/work/input')
os.environ['CV_PROFILE'] = profile
folder = pathlib.Path('/work/input') / ('cv' if kind == 'cv' else 'anschreiben')
entry = 'Lebenslauf.tex' if kind == 'cv' else 'Anschreiben.tex'
engine = 'lualatex' if kind == 'cv' else 'pdflatex'
for turn in range(2):
    result = subprocess.run([engine, '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', entry], cwd=folder)
    if result.returncode:
        sys.exit(result.returncode)
pdf = folder / entry.replace('.tex', '.pdf')
if not pdf.is_file() or pdf.stat().st_size > 32 * 1024 * 1024:
    sys.exit(2)
shutil.copyfile(pdf, '/out/document.pdf')
