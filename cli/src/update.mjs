// 命令行自更新: 下载 Releases 上的单文件 hxaioa.mjs, 写到同目录临时文件再原子替换自身
import { chmodSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import { VERSION, fetchText } from "./http.mjs";

export const CLI_URL = "https://github.com/HengXin666/HX-AIOA/releases/download/cli/hxaioa.mjs";
const SOURCE_ENTRY = "main.mjs";
const VERSION_RE = /\bVERSION = "(\d+)\.(\d+)\.(\d+)"/;

const parse = (v) => (/^(\d+)\.(\d+)\.(\d+)$/.exec(v) ?? []).slice(1).map(Number);
// 0.x 把 x 当大号
const majorOf = ([a, b]) => (a === 0 ? `0.${b}` : `${a}`);
const newer = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/** 正在跑的单文件; 从源码 (src/main.mjs) 跑时返回空, 不能把源码换成打包文件。 */
export function selfPath() {
  if (process.env.HXAIOA_NO_SELF_UPDATE) return "";
  try {
    const p = realpathSync(process.argv[1] ?? "");
    return basename(p) === SOURCE_ENTRY ? "" : p;
  } catch {
    return "";
  }
}

/**
 * 有更新的版本就替换 target; sameMajor 时只接受同大版本内的。
 * 返回新版本号, 没换返回空串; 下载或校验失败抛错, 原文件不动。
 */
export async function selfUpdate(target = selfPath(), { sameMajor = true, current = VERSION } = {}) {
  if (!target) return "";
  const text = await fetchText(process.env.HXAIOA_CLI_URL || CLI_URL);
  const m = VERSION_RE.exec(text);
  if (!m) throw new Error("下载到的不是 hxaioa 单文件");
  const got = m.slice(1).map(Number);
  const cur = parse(current);
  if (!newer(got, cur) || (sameMajor && majorOf(got) !== majorOf(cur))) return "";
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    writeFileSync(tmp, text, { mode: statSync(target).mode & 0o777 });
    chmodSync(tmp, statSync(target).mode & 0o777);
    renameSync(tmp, target);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return got.join(".");
}
