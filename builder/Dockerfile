FROM debian:13-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4
RUN apt-get update && apt-get install -y --no-install-recommends texlive-luatex texlive-latex-extra texlive-fonts-recommended texlive-lang-german fonts-lmodern fontconfig python3 && rm -rf /var/lib/apt/lists/*
COPY build.py /builder.py
COPY fonts.conf /fonts.conf
ENV FONTCONFIG_FILE=/fonts.conf TEXMFVAR=/tmp/texmf-var TEXMFCONFIG=/tmp/texmf-config HOME=/tmp openout_any=p openin_any=a
ENTRYPOINT ["python3", "/builder.py"]
