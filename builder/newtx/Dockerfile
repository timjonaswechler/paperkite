# build.sh binds and verifies this local-only tag to the exact original image ID.
FROM cv-mod-newtx-build-base:8d947e97e799
# Original CTAN NewTX 1.756, checksum verified by install-newtx.py.
# Read-only mounts avoid retaining preparation archives in image layers.
RUN --mount=type=bind,source=newtx.zip,target=/tmp/newtx.zip \
    --mount=type=bind,source=install-newtx.py,target=/tmp/install-newtx.py \
    --mount=type=bind,source=kastrup.zip,target=/tmp/kastrup.zip \
    python3 /tmp/install-newtx.py && \
    mkdir /tmp/binhex-build && cd /tmp/binhex-build && \
    cp /usr/local/share/texmf/doc/generic/kastrup/binhex.dtx /usr/local/share/texmf/doc/generic/kastrup/binhex.ins . && \
    tex -no-shell-escape -interaction=nonstopmode -halt-on-error binhex.ins && \
    mkdir -p /usr/local/share/texmf/tex/generic/kastrup && \
    cp binhex.tex /usr/local/share/texmf/tex/generic/kastrup/ && \
    cd / && rm -rf /tmp/binhex-build && mktexlsr && \
    updmap-sys --enable Map=newtx.map && \
    kpsewhich newtxmath.sty && kpsewhich newtxtext.sty && kpsewhich binhex.tex
