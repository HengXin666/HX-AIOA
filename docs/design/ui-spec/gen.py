#!/usr/bin/env python3
"""由 pages.json 生成 sitemap.svg (页面关系图) 与 prototype.html (可点原型).

用法: python3 gen.py        (在本目录运行, 只用标准库)
加页面 / 改跳转: 只改 pages.json, 再运行本脚本, 三个文件一起提交.
"""
import html
import json
from pathlib import Path

HERE = Path(__file__).parent
DATA = json.loads((HERE / "pages.json").read_text(encoding="utf-8"))

# 令牌 (与 README 的 "令牌" 一节一致, 亮色)
C = {
    "bg": "#FDFDFD", "fg": "#0E0F12", "card": "#FFFFFF", "muted": "#F3F4F5", "mutedFg": "#666970",
    "border": "#E3E4E7", "primary": "#17181B", "brand": "#5D67EE", "brandSoft": "#E9EAFD",
    "danger": "#DF2225", "success": "#16A356", "warning": "#F09C17", "info": "#1289E7",
}
TAB_NAME = {t["id"]: t["label"] for t in DATA["tabs"]}
TYPE_NAME = {
    "tab": "底部栏根页", "block": "根页区块 (不是导航)", "page": "子页: 右侧推入, 标题栏 + 返回",
    "sheet": "底部抽屉: 预览 / 快捷操作", "dialog": "对话框: 只做确认与 1-2 项输入",
    "full": "全屏 Dialog: 待改 (终端除外)", "activity": "独立界面 / 系统入口", "go": "跨栏跳转: 返回回来源栏",
}

COL_X = [32, 212, 452, 702, 952, 1172]
COL_W = [150, 210, 220, 220, 190, 180]
ROW_H = 46
NODE_H = 34
TOP = 168
FONT = "Geist, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Noto Sans CJK SC', sans-serif"


def esc(s):
    return html.escape(s or "", quote=True)


def leaves(n):
    kids = n.get("kids") or []
    return max(1, sum(leaves(k) for k in kids))


def layout(n, depth, y0, out, edges, parent=None):
    """返回节点中心 y; 子节点按叶子数平分竖向空间, 父节点居中."""
    kids = n.get("kids") or []
    if kids:
        ys, y = [], y0
        for k in kids:
            ys.append(layout(k, depth + 1, y, out, edges, n))
            y += leaves(k) * ROW_H
        cy = (ys[0] + ys[-1]) / 2
    else:
        cy = y0 + ROW_H / 2
    n["_x"], n["_y"], n["_d"] = COL_X[depth], cy, depth
    out.append(n)
    for k in kids:
        edges.append((n, k))
    return cy


def node_svg(n):
    t = n.get("t", "tab")
    x, y, d = n["_x"], n["_y"] - NODE_H / 2, n["_d"]
    w = n.get("_w", COL_W[d])
    label = n["label"] if t != "go" else "↗ " + n["label"]
    fill, stroke, dash, color, sub_color, rx = C["card"], C["border"], "", C["fg"], C["mutedFg"], 10
    if t == "tab":
        fill, stroke, color, sub_color, rx = C["primary"], C["primary"], "#FFFFFF", "#B9BBC2", 12
    elif t == "block":
        fill, stroke, rx = C["muted"], C["muted"], 8
    elif t == "sheet":
        fill, stroke = C["brandSoft"], C["brand"]
    elif t == "dialog":
        dash = "4 3"; stroke = C["mutedFg"]
    elif t == "full":
        dash = "4 3"; stroke = C["danger"]
    elif t == "activity":
        fill, stroke = "#EFF0F3", C["fg"]
    elif t == "go":
        dash = "5 3"; stroke = C["warning"]; fill = "#FEF6E8"
    tip = f'{n["label"]} · {TYPE_NAME.get(t, "")}' + (f' · ⚠ {n["warn"]}' if n.get("warn") else "")
    sub = n.get("sub", "")
    if t == "go" and n.get("to"):
        sub = (f'→ {TAB_NAME[n["to"]]}' + (f' · {sub}' if sub else ""))
    s = [f'<g class="n n-{t}" data-id="{esc(n.get("id", ""))}"><title>{esc(tip)}</title>']
    s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{NODE_H}" rx="{rx}" fill="{fill}" stroke="{stroke}" '
             f'stroke-width="1"{f" stroke-dasharray=" + chr(34) + dash + chr(34) if dash else ""}/>')
    if t == "sheet":
        s.append(f'<rect x="{x + w / 2 - 9}" y="{y + 3}" width="18" height="2.5" rx="1.25" fill="{C["brand"]}" opacity=".55"/>')
    ty = y + (13 if sub else 21.5)
    s.append(f'<text x="{x + 11}" y="{ty}" font-size="12.5" font-weight="560" fill="{color}">{esc(label)}</text>')
    if sub:
        s.append(f'<text x="{x + 11}" y="{y + 27}" font-size="10" fill="{sub_color}">{esc(sub[:30])}</text>')
    rt = n.get("rt")
    if rt in ("live", "near"):
        col = C["success"] if rt == "live" else C["warning"]
        cx = x + w - 10
        s.append(f'<circle cx="{cx}" cy="{y + 10}" r="3.5" fill="{col}"/>')
        if rt == "live":
            s.append(f'<circle cx="{cx}" cy="{y + 10}" r="6" fill="none" stroke="{col}" stroke-opacity=".35"/>')
    if t == "page":
        s.append(f'<text x="{x + w - 14}" y="{y + 26}" font-size="12" fill="{C["mutedFg"]}">›</text>')
    if n.get("warn"):
        bx = x + w - 2
        s.append(f'<circle cx="{bx}" cy="{y + 2}" r="7" fill="{C["danger"]}"/>'
                 f'<text x="{bx}" y="{y + 5.5}" font-size="10" font-weight="700" fill="#fff" text-anchor="middle">!</text>')
    s.append("</g>")
    return "".join(s)


def edge_svg(a, b):
    x1, y1 = a["_x"] + COL_W[a["_d"]], a["_y"]
    x2, y2 = b["_x"], b["_y"]
    mx = x1 + 14
    t = b.get("t")
    col, dash, w = "#B9BBC2", "", 1.2
    if t in ("sheet", "dialog", "full"):
        col, dash = C["brand"], "2 3"
    elif t == "go":
        col, dash = C["warning"], "5 3"
    elif t == "block":
        col = "#D5D7DC"
    r = 8 if abs(y2 - y1) > 16 else 0
    if r:
        sgn = 1 if y2 > y1 else -1
        p = (f"M{x1},{y1} H{mx - r} Q{mx},{y1} {mx},{y1 + sgn * r} V{y2 - sgn * r} "
             f"Q{mx},{y2} {mx + r},{y2} H{x2 - 2}")
    else:
        p = f"M{x1},{y1} H{x2 - 2}"
    da = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<path d="{p}" fill="none" stroke="{col}" stroke-width="{w}"{da} marker-end="url(#ar)"/>'


def legend():
    items = [("tab", "底部栏根页"), ("block", "根页区块"), ("page", "子页 (推入)"), ("sheet", "底部抽屉"),
             ("dialog", "对话框"), ("full", "全屏 Dialog (待改)"), ("activity", "独立界面"), ("go", "跨栏跳转")]
    s, x = [], 32
    for t, name in items:
        fake = {"t": t, "label": name, "_x": x, "_y": 120, "_d": 5, "_w": 150}
        s.append(node_svg(fake))
        x += 164
    return "".join(s)


def build_svg():
    nodes, edges = [], []
    y = TOP
    bands = []
    for tab in DATA["tabs"]:
        tab["t"] = "tab"
        h = leaves(tab) * ROW_H
        bands.append((tab, y, h))
        layout(tab, 0, y, nodes, edges)
        y += h + 22
    height = y + 70
    width = 1380
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" '
           f'font-family="{FONT}">',
           '<defs><marker id="ar" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">'
           '<path d="M0,0.8 L7,4 L0,7.2" fill="none" stroke="#9B9EA6" stroke-width="1.3"/></marker></defs>',
           f'<rect width="{width}" height="{height}" fill="{C["bg"]}"/>',
           f'<text x="32" y="48" font-size="24" font-weight="600" fill="{C["fg"]}" letter-spacing="-0.4">HX-AIOA 安卓 · 页面关系</text>',
           f'<text x="32" y="74" font-size="13" fill="{C["mutedFg"]}">返回键一律退一级: 抽屉 / 对话框 → 子页 → 栏 (有来源回来源, 否则回总览) → 退出。'
           f'绿点 = 秒级推送, 橙点 = 进页拉取 + 推送失效; 红 ! = 不符合规范, 待改。由 pages.json 生成。</text>',
           legend()]
    # 栏底色
    for tab, y0, h in bands:
        out.append(f'<rect x="16" y="{y0 - 6}" width="{width - 32}" height="{h + 12}" rx="16" fill="#F7F7F8"/>')
    # 列标题
    for i, name in enumerate(["栏 (L1)", "区块 / 子页 (L2)", "子功能 (L3)", "L4", "L5"]):
        out.append(f'<text x="{COL_X[i] + 4}" y="{TOP - 14}" font-size="11" font-weight="600" fill="{C["mutedFg"]}" '
                   f'letter-spacing=".5">{name}</text>')
    out += [edge_svg(a, b) for a, b in edges]
    out += [node_svg(n) for n in nodes]
    # 启动
    bx = 1172
    out.append(f'<text x="{bx}" y="{TOP - 14}" font-size="11" font-weight="600" fill="{C["mutedFg"]}">进入 App 前 / 外部入口</text>')
    for i, b in enumerate(DATA["boot"]):
        n = dict(b, _x=bx, _y=TOP + 23 + i * ROW_H, _d=5)
        out.append(node_svg(n))
    out.append(f'<text x="32" y="{height - 26}" font-size="11" fill="{C["mutedFg"]}">规范与 issue: docs/design/ui-spec/README.md · '
               f'返回规则: docs/client/android-navigation.md · 权限: docs/client/android-permissions.md</text>')
    out.append("</svg>")
    return "\n".join(out)


def main():
    svg = build_svg()
    (HERE / "sitemap.svg").write_text(svg, encoding="utf-8")
    tpl = (HERE / "prototype.src.html").read_text(encoding="utf-8")
    page = tpl.replace("/*PAGES_JSON*/null", json.dumps(DATA, ensure_ascii=False)).replace("<!--SITEMAP_SVG-->", "".join(line.strip() for line in svg.splitlines()))
    (HERE / "prototype.html").write_text(page, encoding="utf-8")
    print("ok: sitemap.svg, prototype.html")


if __name__ == "__main__":
    main()
