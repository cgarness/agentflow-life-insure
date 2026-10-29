#!/usr/bin/env python3
"""Conservative visual parity for unchanged Dashboard KPI cards (synthetic CI).

The StatCards.tsx Git blob is identical to main. PNG encoding and 1-2 RGB-level
anti-alias differences from Chromium rendering must not fail a visual invariant.
Require exact image dimensions and no larger than a 2-level channel difference;
allow at most 0.75% affected pixels. Real changes (labels, cards, layout,
colors, icons, border width) exceed this strict anti-alias-only threshold.
"""
from pathlib import Path
import struct
import sys
import zlib


def decode(path):
    raw = Path(path).read_bytes()
    assert raw.startswith(b"\x89PNG\r\n\x1a\n"), "not PNG"
    pos = 8
    payload = bytearray()
    width = height = bpp = None
    while pos < len(raw):
        length = struct.unpack_from(">I", raw, pos)[0]
        kind = raw[pos + 4:pos + 8]
        chunk = raw[pos + 8:pos + 8 + length]
        pos += length + 12
        if kind == b"IHDR":
            w, h, depth, color, compression, filt, interlace = struct.unpack(">IIBBBBB", chunk)
            assert depth == 8 and color in (2, 6) and compression == filt == interlace == 0, "unexpected PNG format"
            width, height, bpp = w, h, 3 if color == 2 else 4
        elif kind == b"IDAT":
            payload.extend(chunk)
        elif kind == b"IEND":
            break
    assert width and height and bpp, "missing IHDR"
    packed = zlib.decompress(payload)
    stride = width * bpp
    out = bytearray(height * stride)
    offset = 0
    above = bytearray(stride)
    for row in range(height):
        filter_type = packed[offset]
        offset += 1
        current = bytearray(packed[offset:offset + stride])
        assert len(current) == stride, "truncated PNG row"
        offset += stride
        for i in range(stride):
            left = current[i - bpp] if i >= bpp else 0
            up = above[i]
            upper_left = above[i - bpp] if i >= bpp else 0
            if filter_type == 0:
                predictor = 0
            elif filter_type == 1:
                predictor = left
            elif filter_type == 2:
                predictor = up
            elif filter_type == 3:
                predictor = (left + up) // 2
            elif filter_type == 4:
                p = left + up - upper_left
                distances = (abs(p - left), abs(p - up), abs(p - upper_left))
                predictor = (left, up, upper_left)[distances.index(min(distances))]
            else:
                raise AssertionError("unsupported PNG filter")
            current[i] = (current[i] + predictor) & 255
        out[row * stride:(row + 1) * stride] = current
        above = current
    assert offset == len(packed), "extra PNG bytes"
    return width, height, bpp, out


def compare(a_path, b_path):
    a = decode(a_path)
    b = decode(b_path)
    if a[:3] != b[:3]:
        print(f"FAIL KPI dimensions or pixel format: {a[:3]} versus {b[:3]}")
        return False
    width, height, channels = a[:3]
    diffs = 0
    max_channel_delta = 0
    min_x = min_y = 1_000_000
    max_x = max_y = 0
    for i in range(width * height):
        off = i * channels
        if a[3][off:off + channels] != b[3][off:off + channels]:
            x, y = i % width, i // width
            diffs += 1
            max_channel_delta = max(max_channel_delta, *(abs(v - w) for v, w in zip(a[3][off:off + channels], b[3][off:off + channels])))
            min_x, min_y = min(x, min_x), min(y, min_y)
            max_x, max_y = max(x, max_x), max(y, max_y)
    percent = 100 * diffs / (width * height)
    if max_channel_delta > 2 or percent > 0.75:
        print(f"FAIL KPI visual parity: {diffs}/{width * height} changed pixels ({percent:.4f}%), max RGB delta={max_channel_delta}")
        print(f"Changed-pixel bounding box: x={min_x}..{max_x}, y={min_y}..{max_y}; dimensions={width}x{height}")
        return False
    print(f"PASS KPI visual parity: {width}x{height}, changed pixels={diffs} ({percent:.4f}%), max RGB delta={max_channel_delta}; only anti-alias variation allowed")
    return True


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: compare-kpi.py <candidate.png> <baseline.png>")
    raise SystemExit(0 if compare(sys.argv[1], sys.argv[2]) else 1)
