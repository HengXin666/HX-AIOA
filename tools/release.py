#!/usr/bin/env python3
"""生成增量补丁与 update.json, 供 CI 发布使用。

用法: release.py --apk 新包 --version N --base-url 下载前缀 --out 输出目录 [--old 版本号=旧包路径 ...]
补丁格式 HXPATCH1 见 client/android/.../update/BsPatch.kt。
"""
import argparse
import bz2
import hashlib
import json
import os
import struct
import zlib

import bsdiff4

MAGIC_IN = b"BSDIFF40"
MAGIC_OUT = b"HXPATCH1"


def offtin(b: bytes) -> int:
    y = int.from_bytes(b[:7], "little") | ((b[7] & 0x7F) << 56)
    return -y if b[7] & 0x80 else y


def offtout(x: int) -> bytes:
    raw = abs(x).to_bytes(8, "little")
    return raw[:7] + bytes([raw[7] | (0x80 if x < 0 else 0)])


def convert(patch: bytes) -> bytes:
    if patch[:8] != MAGIC_IN:
        raise ValueError("不是 BSDIFF40 补丁")
    ctrl_len, diff_len, new_size = offtin(patch[8:16]), offtin(patch[16:24]), offtin(patch[24:32])
    body = patch[32:]
    parts = [body[:ctrl_len], body[ctrl_len:ctrl_len + diff_len], body[ctrl_len + diff_len:]]
    packed = [zlib.compress(bz2.decompress(p), 9) for p in parts]
    header = MAGIC_OUT + b"".join(offtout(len(p)) for p in packed) + offtout(new_size)
    return header + b"".join(packed)


def apply(old: bytes, patch: bytes) -> bytes:
    """与 BsPatch.kt 相同的算法, 用于发布前自检。"""
    lens = [offtin(patch[8 + i * 8:16 + i * 8]) for i in range(4)]
    pos = 40
    ctrl = zlib.decompress(patch[pos:pos + lens[0]])
    diff = zlib.decompress(patch[pos + lens[0]:pos + lens[0] + lens[1]])
    extra = zlib.decompress(patch[pos + lens[0] + lens[1]:])
    out = bytearray()
    old_pos = c = d = e = 0
    while len(out) < lens[3]:
        add, copy, seek = (offtin(ctrl[c + i * 8:c + i * 8 + 8]) for i in range(3))
        c += 24
        for i in range(add):
            o = old[old_pos + i] if 0 <= old_pos + i < len(old) else 0
            out.append((diff[d + i] + o) & 0xFF)
        d += add
        old_pos += add
        out += extra[e:e + copy]
        e += copy
        old_pos += seek
    return bytes(out)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apk", required=True)
    ap.add_argument("--version", type=int, required=True)
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--notes", default="")
    ap.add_argument("--old", action="append", default=[])
    args = ap.parse_args()

    new = open(args.apk, "rb").read()
    apk_name = f"HX-AIOA-{args.version}.apk"
    manifest = {
        "versionCode": args.version,
        "versionName": f"0.1.{args.version}",
        "notes": args.notes,
        "apk": {"url": f"{args.base_url}/{apk_name}", "size": len(new), "sha256": sha256(new)},
        "patches": [],
    }
    for item in args.old:
        from_version, path = item.split("=", 1)
        old = open(path, "rb").read()
        patch = convert(bsdiff4.diff(old, new))
        if apply(old, patch) != new:
            raise SystemExit(f"补丁自检失败: {from_version}")
        # 补丁不比完整包小一截就没必要发
        if len(patch) > len(new) * 0.8:
            print(f"跳过 {from_version}: 补丁 {len(patch)} 字节, 收益太小")
            continue
        name = f"HX-AIOA-{from_version}-to-{args.version}.patch"
        with open(os.path.join(args.out, name), "wb") as f:
            f.write(patch)
        manifest["patches"].append({
            "from": int(from_version),
            "fromSha256": sha256(old),
            "url": f"{args.base_url}/{name}",
            "size": len(patch),
            "sha256": sha256(patch),
        })
        print(f"补丁 {name}: {len(patch)} 字节, 完整包 {len(new)} 字节")
    with open(os.path.join(args.out, "update.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
