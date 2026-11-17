FROM debian:13-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4
RUN apt-get update && apt-get install -y --no-install-recommends qpdf ghostscript python3 python3-pil python3-img2pdf poppler-utils && rm -rf /var/lib/apt/lists/*
COPY process.py /process.py
ENV HOME=/tmp LANG=C.UTF-8
ENTRYPOINT ["python3", "/process.py"]
