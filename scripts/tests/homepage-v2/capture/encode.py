"""Encode synthetic DOM recordings; validate actual outputs and document bytes.

Usage: python scripts/tests/homepage-v2/capture/encode.py INPUT_DIRECTORY
Raw files are dashboard.webm, dialer.webm, leaderboard.webm, conversations.webm.
No credentials, service connections or production writes are involved.
"""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
INPUT = Path(sys.argv[1]).resolve()
OUTPUT = ROOT / "public/marketing-v2"
EVIDENCE = ROOT / "docs/plans/2026-10-29-private-homepage-v2"
SCENES = {"dashboard": 1.1, "dialer": 2.8, "leaderboard": 2.7, "conversations": 4.5}


def run(args):
    return subprocess.check_output(args, text=True)


def ffmpeg(*args):
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *map(str, args)])


def encode(item):
    name, poster_time = item
    source = INPUT / f"{name}.webm"
    mp4, webm, poster = (OUTPUT / f"{name}.{suffix}" for suffix in ["mp4", "webm", "webp"])
    strip = ["-map_metadata", "-1", "-map_chapters", "-1"]
    ffmpeg("-i", source, "-map", "0:v:0", "-an", "-sn", "-t", "6", "-vf", "fps=30,format=yuv420p",
           "-c:v", "libx264", "-crf", "23", "-preset", "slow", "-profile:v", "high", "-level:v", "3.1",
           "-movflags", "+faststart", *strip, mp4)
    ffmpeg("-i", mp4, "-ss", str(poster_time), "-frames:v", "1", "-c:v", "libwebp", "-quality", "85", poster)
    ffmpeg("-i", mp4, "-map", "0:v:0", "-an", "-c:v", "libvpx-vp9", "-crf", "33", "-b:v", "0",
           "-row-mt", "1", "-cpu-used", "3", *strip, webm)
    results = []
    for path in [mp4, webm]:
        probe = json.loads(run(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)]))
        assert len(probe["streams"]) == 1 and probe["streams"][0]["codec_type"] == "video", f"Audio in {path}"
        stream = probe["streams"][0]
        assert (stream["width"], stream["height"]) == (960, 600)
        duration = float(probe["format"]["duration"])
        assert 5 <= duration <= 7, f"Invalid duration: {path}"
        assert path.stat().st_size <= 1_000_000, f"Over byte budget: {path}"
        if path.suffix == ".mp4":
            data = path.read_bytes()
            assert data.index(b"moov") < data.index(b"mdat"), "MP4 is not fast-start"
        results.append({"path": str(path.relative_to(ROOT)), "bytes": path.stat().st_size,
                        "duration_seconds": duration, "width": stream["width"], "height": stream["height"],
                        "codec": stream["codec_name"], "audio_streams": 0,
                        "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        # Decode every frame, including the WebM fallback, before recording success.
        ffmpeg("-i", path, "-f", "null", "-")
    assert poster.stat().st_size <= 120_000
    results.append({"path": str(poster.relative_to(ROOT)), "bytes": poster.stat().st_size,
                    "sha256": hashlib.sha256(poster.read_bytes()).hexdigest(), "poster_time": poster_time})
    ffmpeg("-i", mp4, "-vf", "fps=2,scale=480:-1,tile=4x3", "-frames:v", "1", INPUT / f"{name}-review.jpg")
    return {"scene": name, "assets": results}


OUTPUT.mkdir(parents=True, exist_ok=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    scenes = list(pool.map(encode, SCENES.items()))
manifest = {"capture": "Recorded shipped UI components in an isolated synthetic workspace; simulated activity only",
            "source_commit": "975cd1544888feec55ed94881092ad3fd10d2353", "capture_size": [1200, 750],
            "output_size": [960, 600], "no_live_calls_or_messages": True, "scenes": scenes}
EVIDENCE.mkdir(parents=True, exist_ok=True)
(EVIDENCE / "media-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps({"scenes": len(scenes), "assets": sum(len(scene["assets"]) for scene in scenes),
                  "total_bytes": sum(asset["bytes"] for scene in scenes for asset in scene["assets"])}))
