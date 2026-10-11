#!/bin/sh
# Cuts the captured shots into the launch video:
#   ./assemble.sh [cinedir] [out.mp4]
# Shots (cine.py, then mobile.py's 06b_mobile) play back to back in name order at 60 fps (the whips are built into the shots),
# the 2.39:1 frames are letterboxed to 1920x1080, and score.py's soundtrack
# goes underneath.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
CINE=${1:-/tmp/office-demo/cine}
OUT=${2:-$CINE/agent-office-launch.mp4}

LIST=$CINE/frames.txt
: > "$LIST"
for d in $(LC_ALL=C /bin/ls -d "$CINE"/[0-9][0-9]*/); do
  for f in "$d"*.jpg; do printf "file '%s'\nduration 0.0166667\n" "$f" >> "$LIST"; done
done

/opt/homebrew/bin/python3.13 -I "$HERE/score.py" "$CINE" "$CINE/score.wav"

ffmpeg -loglevel error -y -f concat -safe 0 -i "$LIST" -i "$CINE/score.wav" \
  -vf "fps=60,pad=1920:1080:0:(oh-ih)/2:color=0x141210,format=yuv420p" \
  -c:v libx264 -preset slow -crf 16 -profile:v high -movflags +faststart \
  -c:a aac -b:a 192k -shortest "$OUT"
echo "$OUT"
