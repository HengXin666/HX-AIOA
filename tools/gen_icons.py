#!/usr/bin/env python3
"""从 lucide-static 拉取线性图标, 转成 Compose ImageVector 的 Kotlin 源文件。"""
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

LUCIDE_VERSION = "1.77.0"
ICONS = [
    "activity", "alert-triangle", "bell", "check", "cpu", "gauge", "hard-drive",
    "memory-stick", "message-circle", "moon", "palette", "plug", "refresh-cw", "server", "settings", "sun",
    "thermometer", "user", "wifi-off",
    "bot", "chevron-down", "chevron-up", "file-text", "layout-dashboard", "maximize-2", "minimize-2", "send", "shield-check",
    "git-branch", "git-pull-request", "circle-dot", "git-commit-horizontal", "tag", "star", "message-square",
    "circle-play", "external-link", "puzzle", "list-checks", "square", "square-check", "download", "trash-2", "copy",
    "chevron-left", "chevron-right", "x", "globe", "shield-off",
    "search", "mail", "mail-open", "inbox", "check-check", "flame", "archive", "at-sign", "corner-up-left", "users", "calendar-days", "link", "ban", "circle-check",
    "folder", "eye", "eye-off", "sliders-horizontal", "key-round", "monitor", "circle-pause", "circle-dashed", "clock", "languages", "thumbs-up",
    "terminal", "plus", "play", "file", "corner-left-up",
]
# Lucide 已移除品牌图标, 这些名字借用相近图标的路径
ALIASES = {"github": "git-branch"}
OUT = Path(__file__).resolve().parent.parent / "client/android/ui/src/commonMain/kotlin/com/hengxin/aioa/kit/LucideIcons.kt"


def fetch(name: str) -> str:
    url = f"https://unpkg.com/lucide-static@{LUCIDE_VERSION}/icons/{name}.svg"
    with urllib.request.urlopen(url, timeout=30) as r:
        return r.read().decode()


def num(v: str) -> float:
    return float(v or 0)


def to_path(el: ET.Element) -> str:
    tag = el.tag.split("}")[-1]
    a = el.attrib
    if tag == "path":
        return a["d"]
    if tag == "line":
        return f"M{a['x1']} {a['y1']}L{a['x2']} {a['y2']}"
    if tag == "polyline" or tag == "polygon":
        pts = re.split(r"[\s,]+", a["points"].strip())
        pairs = [f"{pts[i]} {pts[i + 1]}" for i in range(0, len(pts) - 1, 2)]
        return "M" + "L".join(pairs) + ("Z" if tag == "polygon" else "")
    if tag == "circle":
        cx, cy, r = num(a["cx"]), num(a["cy"]), num(a["r"])
        return f"M{cx - r} {cy}a{r} {r} 0 1 0 {2 * r} 0a{r} {r} 0 1 0 {-2 * r} 0"
    if tag == "rect":
        x, y, w, h = num(a.get("x")), num(a.get("y")), num(a["width"]), num(a["height"])
        rx = num(a.get("rx", a.get("ry", "0")))
        if rx == 0:
            return f"M{x} {y}h{w}v{h}h{-w}Z"
        return (f"M{x + rx} {y}h{w - 2 * rx}a{rx} {rx} 0 0 1 {rx} {rx}v{h - 2 * rx}"
                f"a{rx} {rx} 0 0 1 {-rx} {rx}h{-(w - 2 * rx)}a{rx} {rx} 0 0 1 {-rx} {-rx}"
                f"v{-(h - 2 * rx)}a{rx} {rx} 0 0 1 {rx} {-rx}Z")
    raise ValueError(f"未支持的元素 {tag}")


def camel(name: str) -> str:
    return "".join(p.capitalize() for p in name.split("-"))


def main() -> int:
    lines = [
        "// 由 tools/gen_icons.py 生成, 请勿手改。图标来自 Lucide (ISC 许可)。",
        "package com.hengxin.aioa.kit",
        "",
        "/** 图标名到 SVG 路径的映射, 由 [Icons] 转成 ImageVector。 */",
        "internal object LucidePaths {",
        "    val all: Map<String, List<String>> = mapOf(",
    ]
    bodies = {}
    for name in ICONS:
        root = ET.fromstring(fetch(name))
        paths = [to_path(el) for el in root if el.tag.split("}")[-1] != "title"]
        body = ", ".join('"' + p.replace('"', "") + '"' for p in paths)
        bodies[name] = body
        lines.append(f'        "{name}" to listOf({body}),')
    for alias, target in ALIASES.items():
        lines.append(f'        "{alias}" to listOf({bodies[target]}),')
    lines += ["    )", "}", ""]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"写入 {OUT.name}, 共 {len(ICONS)} 个图标")
    return 0


if __name__ == "__main__":
    sys.exit(main())
