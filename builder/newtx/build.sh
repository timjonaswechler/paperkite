#!/bin/sh
# Supplement the exact original builder; this does not activate the new image.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo=$(CDPATH= cd -- "$here/../.." && pwd)
context=${TEX_DEPENDENCY_CACHE:-"$repo/.work/tex-newtx-dependencies"}
mkdir -p "$context"
python3 "$here/download.py" "$context"
cp "$here/Dockerfile" "$here/install-newtx.py" "$context/"
base=sha256:8d947e97e799946adfd1e0f42b34be6647b7a4ccf2ea4567f07263d516417b5f
tag=cv-mod-newtx-build-base:8d947e97e799
docker tag "$base" "$tag"
test "$(docker image inspect "$tag" --format '{{.Id}}')" = "$base"
docker build --pull=false --network=none --progress=plain --iidfile "$context/image-id" "$context"
printf 'Candidate only (builder/image-id unchanged): '
head -1 "$context/image-id"
