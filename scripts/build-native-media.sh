#!/usr/bin/env bash
set -euo pipefail

version=9.0.2
target="${REPORTER_NATIVE_OUTPUT:-$PWD/.reporter-native}"
mkdir -p "$target"
source_dir="$target/source"
mkdir -p "$source_dir"
archive="$source_dir/ffmpeg-$version.tar.xz"
if [[ ! -f "$archive" ]]; then
  curl --fail --location --retry 3 "https://ffmpeg.org/releases/ffmpeg-$version.tar.xz" --output "$archive"
fi
curl --fail --location --retry 3 "https://ffmpeg.org/releases/ffmpeg-$version.tar.xz.asc" --output "$archive.asc"
curl --fail --location --retry 3 https://ffmpeg.org/ffmpeg-devel.asc --output "$source_dir/release-key.asc"
mkdir -p "$source_dir/gnupg"
chmod 700 "$source_dir/gnupg"
gpg --batch --homedir "$source_dir/gnupg" --import "$source_dir/release-key.asc"
gpg --batch --homedir "$source_dir/gnupg" --with-colons --fingerprint | rg -q 'FCF986EA15E6E293A5644F10B4322F04D67658D8'
gpg --batch --homedir "$source_dir/gnupg" --status-fd 1 --verify "$archive.asc" "$archive" | rg -q "^\[GNUPG:\] VALIDSIG FCF986EA15E6E293A5644F10B4322F04D67658D8 "
tar -xf "$archive" -C "$source_dir"
cd "$source_dir/ffmpeg-$version"
cross=()
if [[ "${REPORTER_NATIVE_CROSS:-}" == true ]]; then
  cross=(--arch=aarch64 --target-os=linux --enable-cross-compile --cross-prefix=aarch64-linux-gnu-)
fi
./configure --prefix="$target/release" "${cross[@]}" \
  --disable-everything --disable-autodetect --disable-doc --disable-debug \
  --disable-static --enable-shared --enable-small --disable-avdevice --disable-swscale \
  --enable-ffmpeg --enable-ffprobe --enable-network --enable-swresample --enable-avfilter \
  --enable-protocol=file,http,tcp,pipe \
  --enable-demuxer=mov,mp3,wav,ogg,flac,matroska \
  --enable-decoder=aac,mp3,mp3float,flac,opus,vorbis,alac,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f64le \
  --enable-parser=aac,mpegaudio,flac,opus,vorbis \
  --enable-encoder=flac --enable-muxer=flac \
  --enable-filter=aresample,aformat,anull,atrim \
  --extra-cflags='-Os -ffunction-sections -fdata-sections' --extra-ldflags='-Wl,--gc-sections'
make -j "${REPORTER_NATIVE_JOBS:-2}"
make install
rm -rf "$target/bundle"
mkdir -p "$target/bundle/bin/lib"
cp "$target/release/bin/ffmpeg" "$target/release/bin/ffprobe" "$target/bundle/bin/"
for library in avcodec avformat avutil avfilter swresample; do
  soname=$(find "$target/release/lib" -maxdepth 1 -name "lib$library.so.[0-9]*" -type l | head -n 1)
  cp -L "$soname" "$target/bundle/bin/lib/$(basename "$soname")"
done
cp COPYING.LGPLv2.1 "$target/bundle/FFmpeg-LICENSE.txt"
printf '%s\n' "$version" > "$target/bundle/FFmpeg-VERSION.txt"
du -sh "$target/bundle"
