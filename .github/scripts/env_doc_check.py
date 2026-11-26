"""核对环境变量总表 docs/deploy/env.md 与代码, 部署配置一致 (#119)。"""
import glob
import re
import sys

DOC = "docs/deploy/env.md"
NAME = re.compile(r"`([A-Z][A-Z0-9_]+)`")


def used() -> set[str]:
    names: set[str] = set()
    env = open("server/src/env.ts", encoding="utf-8").read()
    names |= set(re.findall(r"^\s+([A-Z][A-Z0-9_]+)\??:", env, re.M))
    toml = open("server/wrangler.toml", encoding="utf-8").read()
    names |= set(re.findall(r'^binding\s*=\s*"([A-Z][A-Z0-9_]+)"', toml, re.M))
    vars_block = re.search(r"^\[vars\]\n((?:[A-Z][A-Z0-9_]*\s*=.*\n)+)", toml, re.M)
    if vars_block:
        names |= set(re.findall(r"^([A-Z][A-Z0-9_]+)\s*=", vars_block.group(1), re.M))
    for wf in glob.glob(".github/workflows/*.yml"):
        s = open(wf, encoding="utf-8").read()
        names |= set(re.findall(r"\b(?:secrets|vars)\.([A-Z][A-Z0-9_]+)", s))
        names |= set(re.findall(r"wrangler secret put ([A-Z][A-Z0-9_]+)", s))
    return names


def documented() -> set[str]:
    names: set[str] = set()
    for line in open(DOC, encoding="utf-8"):
        if not line.startswith("| ") or line.startswith("| ---") or line.startswith("| Worker"):
            continue
        cells = line.split("|")[1:3]
        for c in cells:
            names |= set(NAME.findall(c))
    return names


def main() -> int:
    u, d = used(), documented()
    missing, stale = sorted(u - d), sorted(d - u)
    for n in missing:
        print(f"::error::{n} 在代码或部署配置里用到, 但 {DOC} 没写")
    for n in stale:
        print(f"::error::{n} 写在 {DOC}, 但代码和部署配置里已经没有了")
    if missing or stale:
        print("改环境变量要同一个提交更新总表, 见 AGENTS.md")
        return 1
    print(f"环境变量总表一致, 共 {len(u)} 项")
    return 0


if __name__ == "__main__":
    sys.exit(main())
