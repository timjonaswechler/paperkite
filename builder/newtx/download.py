"""Fetch only the checksum-pinned original CTAN dependencies (preparation only)."""
import hashlib
import pathlib
import sys
import urllib.request

root = pathlib.Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
packages = [
    ("newtx.zip", "https://mirrors.ctan.org/fonts/newtx.zip", "bbe07d4ad91ade9f61326e59f2f3bf389b4ace1c0c1ef2e8c85377e4e2535f4e"),
    ("kastrup.zip", "https://mirrors.ctan.org/macros/generic/kastrup.zip", "c3ec4e73ca69bc2f8e813c01618b670a936e24a465228ccf06b8c6ae28f7220e"),
]
for name, url, expected in packages:
    target = root / name
    if target.exists():
        data = target.read_bytes()
    else:
        with urllib.request.urlopen(url, timeout=60) as response:
            if not response.url.startswith("https://"):
                raise RuntimeError("Refusing insecure package redirect")
            data = response.read(32 * 1024 * 1024 + 1)
    if len(data) > 32 * 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError("Dependency checksum mismatch; do not silently update: " + name)
    target.write_bytes(data)
    print(name, expected)
