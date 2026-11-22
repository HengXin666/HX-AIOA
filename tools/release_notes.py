#!/usr/bin/env python3
"""从上一个安卓发布标签到 HEAD 的提交标题生成更新说明, 供 release.py 写进 update.json。

用法: release_notes.py --since 上个标签或提交 [--max 30] --out changes.json
合并 PR 的提交取 PR 标题 (提交正文第一行), 其余取提交标题; 跳过纯 CI / 文档 / 合并噪音。
"""
import argparse
import json
import re
import subprocess

SKIP = re.compile(r"^(Merge branch|Revert \"Merge|chore\(ci\)|ci:|docs?:)", re.IGNORECASE)
PR_MERGE = re.compile(r"^Merge pull request #(\d+)")
SEP = "\x1f"
END = "\x1e"


def git_log(since: str) -> list[tuple[str, str, str]]:
    rng = f"{since}..HEAD" if since else "HEAD"
    fmt = f"%h{SEP}%s{SEP}%b{END}"
    out = subprocess.run(
        ["git", "log", "--first-parent", f"--pretty=format:{fmt}", rng, "--", "client/android", "protocol", "tools/release.py"],
        check=True, capture_output=True, text=True,
    ).stdout
    rows = []
    for raw in out.split(END):
        raw = raw.strip("\n")
        if not raw:
            continue
        sha, subject, body = (raw.split(SEP) + ["", ""])[:3]
        rows.append((sha, subject.strip(), body.strip()))
    return rows


def changes(since: str, limit: int) -> list[dict]:
    result = []
    for sha, subject, body in git_log(since):
        m = PR_MERGE.match(subject)
        if m:
            title = body.splitlines()[0].strip() if body else subject
            item = {"title": title, "sha": sha, "pr": int(m.group(1))}
        elif SKIP.match(subject):
            continue
        else:
            item = {"title": subject, "sha": sha}
        if item["title"] and all(x["title"] != item["title"] for x in result):
            result.append(item)
        if len(result) >= limit:
            break
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="")
    ap.add_argument("--max", type=int, default=30)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    items = changes(args.since, args.max)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(items, f, ensure_ascii=False, indent=2)
    for x in items:
        print(f"- {x['title']}")


if __name__ == "__main__":
    main()
