#!/usr/bin/env bash

set -Eeuo pipefail

input=${TD_LOCAL_PATH:?TD_LOCAL_PATH must be set}
if [[ ! -f "$input" ]]; then
  printf 'browser compatibility check: missing input %s\n' "$input" >&2
  exit 1
fi

# td creates these siblings when --video-pipeline converts MKV or normalizes
# audio. Prefer the file that td will upload over the original torrent file.
stem=${input%.*}
candidate="$input"
for sibling in "${stem}.normalized.mp4" "${stem}.mp4"; do
  if [[ -f "$sibling" ]]; then
    candidate="$sibling"
    break
  fi
done

probe=$(ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,pix_fmt \
  -of default=noprint_wrappers=1:nokey=0 "$candidate")
video_codec=$(printf '%s\n' "$probe" | awk -F= '$1 == "codec_name" { print tolower($2); exit }')
pixel_format=$(printf '%s\n' "$probe" | awk -F= '$1 == "pix_fmt" { print tolower($2); exit }')
audio_codecs=$(ffprobe -v error -select_streams a \
  -show_entries stream=codec_name -of csv=p=0 "$candidate" | tr '[:upper:]' '[:lower:]' | tr '\n' ' ')

# MP4's mov_text encoder cannot convert bitmap subtitle codecs such as PGS.
# Keep only text subtitle streams; dropping unsupported bitmap subtitles is
# preferable to losing an otherwise valid dual-audio video.
subtitle_map_args=()
while IFS=',' read -r stream_index subtitle_codec; do
  subtitle_codec=${subtitle_codec//$'\r'/}
  case "${subtitle_codec,,}" in
    ass|jacosub|microdvd|mpl2|mov_text|pjs|realtext|sami|srt|ssa|stl|subrip|subviewer|subviewer1|text|ttml|vplayer|webvtt)
      subtitle_map_args+=("-map" "0:${stream_index}")
      ;;
  esac
done < <(ffprobe -v error -select_streams s \
  -show_entries stream=index,codec_name -of csv=p=0 "$candidate")

audio_compatible=true
for codec in $audio_codecs; do
  case "$codec" in
    aac|mp3) ;;
    *) audio_compatible=false; break ;;
  esac
done

if [[ "$video_codec" == "h264" && "$pixel_format" == "yuv420p" && "$audio_compatible" == true ]]; then
  exit 0
fi

tmp="${candidate}.browser-compatible.$$.mp4"
cleanup() { rm -f -- "$tmp"; }
trap cleanup EXIT

encode_args=(
  -y -hide_banner -i "$candidate"
  -map 0:v:0 -map 0:a? "${subtitle_map_args[@]}"
  -dn -map_metadata 0 -map_chapters 0
  -c:v libx264 -preset "${MEDIA_MANAGER_BROWSER_PRESET:-fast}"
  -crf "${MEDIA_MANAGER_BROWSER_CRF:-20}" -pix_fmt yuv420p
  -c:a aac -b:a "${MEDIA_MANAGER_BROWSER_AUDIO_BITRATE:-192k}"
  -c:s mov_text -movflags +faststart
  "$tmp"
)

if ! ffmpeg "${encode_args[@]}"; then
  # Bitmap or malformed subtitle streams must not prevent the video itself
  # from becoming browser-compatible.
  rm -f -- "$tmp"
  ffmpeg -y -hide_banner -i "$candidate" \
    -map 0:v:0 -map 0:a? -dn -map_metadata 0 -map_chapters 0 \
    -c:v libx264 -preset "${MEDIA_MANAGER_BROWSER_PRESET:-fast}" \
    -crf "${MEDIA_MANAGER_BROWSER_CRF:-20}" -pix_fmt yuv420p \
    -c:a aac -b:a "${MEDIA_MANAGER_BROWSER_AUDIO_BITRATE:-192k}" \
    -movflags +faststart "$tmp"
fi

mv -f -- "$tmp" "$candidate"
printf 'browser compatibility: re-encoded %s (%s/%s)\n' "$candidate" "$video_codec" "$pixel_format" >&2
