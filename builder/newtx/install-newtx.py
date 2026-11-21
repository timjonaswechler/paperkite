import hashlib, pathlib, zipfile
archive = pathlib.Path('/tmp/newtx.zip')
assert hashlib.sha256(archive.read_bytes()).hexdigest() == 'bbe07d4ad91ade9f61326e59f2f3bf389b4ace1c0c1ef2e8c85377e4e2535f4e'
root = pathlib.Path('/usr/local/share/texmf')
destinations = {'tex':'tex/latex/newtx','type1':'fonts/type1/public/newtx','opentype':'fonts/opentype/public/newtx','afm':'fonts/afm/public/newtx','tfm':'fonts/tfm/public/newtx','vf':'fonts/vf/public/newtx','enc':'fonts/enc/dvips/newtx','map':'fonts/map/dvips/newtx','doc':'doc/fonts/newtx'}
with zipfile.ZipFile(archive) as z:
    for member in z.infolist():
        if member.is_dir(): continue
        parts = pathlib.PurePosixPath(member.filename).parts
        assert parts[0] == 'newtx' and '..' not in parts
        if len(parts) == 2:
            target = root / 'doc/fonts/newtx' / parts[1]
        else:
            assert parts[1] in destinations, member.filename
            target = root / destinations[parts[1]] / pathlib.Path(*parts[2:])
        assert not target.exists(), str(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(z.read(member))
print('Installed original NewTX 1.756 (2025-01-09), CTAN archive, including licenses/docs.')
archive = pathlib.Path('/tmp/kastrup.zip')
assert hashlib.sha256(archive.read_bytes()).hexdigest() == 'c3ec4e73ca69bc2f8e813c01618b670a936e24a465228ccf06b8c6ae28f7220e'
with zipfile.ZipFile(archive) as z:
    for member in z.infolist():
        if member.is_dir(): continue
        parts = pathlib.PurePosixPath(member.filename).parts
        assert len(parts) == 2 and parts[0] == 'kastrup' and '..' not in parts
        target = root / 'doc/generic/kastrup' / parts[1]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(z.read(member))
print('Installed original Kastrup/binhex sources and documentation.')
