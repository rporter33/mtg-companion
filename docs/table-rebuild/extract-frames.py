#!/usr/bin/env python3
"""
Turn a screen recording into the handful of frames worth looking at.

A three-minute capture at 60fps is ten thousand pictures of mostly the same
screen. What is wanted is the distinct states the interface passed through:
each panel that opened, each screen that changed. So this samples a couple of
frames a second, drops any frame that looks like the one before it, and caps
the result — sorted by how much changed, so the most different states survive
the cap rather than just the earliest ones.
"""
import subprocess, sys, shutil
from pathlib import Path
import imageio_ffmpeg

FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def probe(video):
    out = subprocess.run(
        [FFMPEG, "-i", str(video)], capture_output=True, text=True
    ).stderr
    for line in out.splitlines():
        if "Duration" in line or "Stream #" in line and "Video" in line:
            print("   ", line.strip())


def extract(video, outdir, fps=2, width=1000, cap=48, threshold=6.0):
    outdir = Path(outdir)
    if outdir.exists():
        shutil.rmtree(outdir)
    outdir.mkdir(parents=True)

    raw = outdir / "raw"
    raw.mkdir()
    # Sample evenly rather than by scene detection: a UI cross-fade reads as a
    # scene change and a panel sliding in does not, so an even sweep plus a
    # similarity pass afterwards is the more reliable pair.
    subprocess.run(
        [FFMPEG, "-nostdin", "-loglevel", "error", "-i", str(video),
         "-vf", f"fps={fps},scale={width}:-2:flags=lanczos",
         "-q:v", "3", str(raw / "f%05d.jpg")],
        check=True,
    )

    from PIL import Image
    import numpy as np

    frames = sorted(raw.glob("*.jpg"))
    if not frames:
        print("no frames came out of that file")
        return []

    # How different each frame is from the last one kept: a coarse greyscale
    # thumbnail is enough to tell "the menu opened" from "the cursor moved".
    def thumb(p):
        return np.asarray(Image.open(p).convert("L").resize((64, 64)), dtype=np.int16)

    kept, last = [], None
    for f in frames:
        t = thumb(f)
        diff = 999.0 if last is None else float(np.abs(t - last).mean())
        if diff >= threshold:
            kept.append((f, diff))
            last = t

    # Keep the most different states when there are more than the cap, but put
    # them back in the order they happened: a walkthrough read out of order is
    # not a walkthrough.
    if len(kept) > cap:
        kept = sorted(sorted(kept, key=lambda k: -k[1])[:cap], key=lambda k: k[0].name)

    for i, (f, diff) in enumerate(kept, 1):
        at = frames.index(f) / fps
        f.rename(outdir / f"{i:02d}_at{int(at//60)}m{int(at%60):02d}s.jpg")
    shutil.rmtree(raw)
    return sorted(outdir.glob("*.jpg"))


if __name__ == "__main__":
    video = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else "out"
    print(f"reading {video}")
    probe(video)
    got = extract(video, out, **{k: float(v) if "." in v else int(v)
                                for k, v in (a.split("=") for a in sys.argv[3:])})
    print(f"\n{len(got)} frames worth looking at, in {out}/")
    for g in got:
        print("   ", g.name, f"{g.stat().st_size // 1024}KB")
