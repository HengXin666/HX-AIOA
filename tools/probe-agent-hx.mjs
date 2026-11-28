// hx 方法里的 git 与文件: 都限定在会话 cwd 下
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { insideCwd } from "./probe-agent-acp.mjs";
import { DIFF_MAX, FS_READ_MAX, SKIP_DIRS, TREE_MAX } from "./probe-agent-const.mjs";

const UTF8 = "utf8";
const CACHED = "--cached";
const Z = "-z";
const SEP = "--";
const DIFF = "diff";

const GIT = "git";
const GIT_TIMEOUT_MS = 15_000;
const NUL = "\0";

function git(cwd, args, max = DIFF_MAX * 2) {
  return new Promise((resolve, reject) => {
    execFile(GIT, args, { cwd, maxBuffer: max, timeout: GIT_TIMEOUT_MS, encoding: UTF8 }, (err, out, errOut) => {
      if (err && !(err.code === 1 && out)) return reject(new Error((errOut || err.message).trim()));
      resolve(out);
    });
  });
}

export async function gitBranch(cwd) {
  try {
    return (await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).trim() || undefined;
  } catch {
    return undefined;
  }
}

function numstat(out, map) {
  const parts = out.split(NUL);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    const [add, del, file] = p.split("\t");
    // 改名时路径为空, 后面跟着 旧路径 新路径 两段
    const name = file || parts[(i += 2)];
    const cur = map.get(name) ?? { add: 0, del: 0 };
    cur.add += Number(add) || 0;
    cur.del += Number(del) || 0;
    map.set(name, cur);
  }
}

export async function gitStatus(cwd) {
  const out = await git(cwd, ["status", "--porcelain=v1", "-b", Z]);
  const parts = out.split(NUL);
  let branch;
  const files = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!p) continue;
    if (p.startsWith("## ")) {
      branch = p.slice(3).split("...")[0];
      continue;
    }
    const f = { path: p.slice(3), x: p[0], y: p[1], add: 0, del: 0 };
    if (p[0] === "R" || p[0] === "C") f.from = parts[++i];
    files.push(f);
  }
  const stat = new Map();
  numstat(await git(cwd, [DIFF, "--numstat", Z]).catch(() => ""), stat);
  numstat(await git(cwd, [DIFF, CACHED, "--numstat", Z]).catch(() => ""), stat);
  for (const f of files) Object.assign(f, stat.get(f.path) ?? {});
  return { branch, files };
}

export async function gitDiff(cwd, p = {}) {
  let out;
  if (p.path) {
    const file = path.relative(fs.realpathSync(cwd), insideCwd(cwd, p.path));
    const tracked = await git(cwd, ["ls-files", SEP, file]).catch(() => "");
    out = tracked.trim() || p.staged
      ? await git(cwd, [DIFF, ...(p.staged ? [CACHED] : []), SEP, file])
      : await git(cwd, [DIFF, "--no-index", SEP, os.devNull, file]).catch((e) => e.message);
  } else {
    out = await git(cwd, [DIFF, ...(p.staged ? [CACHED] : [])]);
  }
  const truncated = Buffer.byteLength(out) > DIFF_MAX;
  return { diff: truncated ? Buffer.from(out).subarray(0, DIFF_MAX).toString(UTF8) : out, ...(truncated ? { truncated } : {}) };
}

export function fsTree(cwd, p) {
  const dir = insideCwd(cwd, p ?? ".");
  const entries = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(d.name)) continue;
    if (entries.length >= TREE_MAX) break;
    let size = 0;
    const isDir = d.isDirectory();
    if (!isDir) {
      try {
        size = fs.statSync(path.join(dir, d.name)).size;
      } catch {}
    }
    entries.push({ name: d.name, dir: isDir, size });
  }
  entries.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return { entries };
}

export function fsRead(cwd, p) {
  const file = insideCwd(cwd, p);
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(Math.min(size, FS_READ_MAX));
  try {
    fs.readSync(fd, buf, 0, buf.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (buf.includes(0)) return { text: "", truncated: false, binary: true, size };
  return { text: buf.toString(UTF8), truncated: size > FS_READ_MAX, size };
}
