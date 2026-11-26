import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fakeServer, home, readJsonFile, run } from "./helpers.mjs";

const GIT = "https://raw.githubusercontent.com";
const SKILL_PATH = "/HengXin666/HX-AIOA/main/skills/hx-aioa";
const TODO_PATH = "/HengXin666/HX-AIOA/main/plugins/hengxin666.todo/skill";
const ME = { me: { name: "イデア", channel: "g1", sourceId: "agent:1" } };

// 假 raw 服务器: files 是 路径 -> 内容, 没有的 404
async function rawServer(files) {
  return fakeServer(({ path }) => (path in files ? { text: files[path] } : undefined));
}

function brief(version, todoVersion = "1.0") {
  return {
    version: "b1",
    name: "イデア",
    channel: "g1",
    title: "点子待办",
    reads: ["g1"],
    skills: [
      { id: "hx-aioa", version, url: `${GIT}${SKILL_PATH}` },
      { id: "hengxin666.todo", version: todoVersion, url: `${GIT}${TODO_PATH}` },
    ],
    want: { setup: 1, skills: { "hx-aioa": version, "hengxin666.todo": todoVersion } },
    missing: [],
  };
}

function api(want, b) {
  return fakeServer(({ path }) => {
    const headers = { "X-Aioa-Want": want };
    if (path === "/api/v1/chat-agent/me") return { json: ME, headers };
    if (path === "/api/v1/chat-agent/next") return { json: { pending: [], head: 10, cursor: 10, briefVersion: b.version, brief: b }, headers };
  });
}

const skillFiles = (v, extra = {}) => ({
  [`${SKILL_PATH}/manifest.json`]: JSON.stringify({ name: "hx-aioa", version: v, files: ["SKILL.md", "steps/1-next/index.md"] }),
  [`${SKILL_PATH}/SKILL.md`]: `核心 ${v}`,
  [`${SKILL_PATH}/steps/1-next/index.md`]: "next",
  [`${TODO_PATH}/manifest.json`]: JSON.stringify({ name: "hengxin666.todo", version: "1.0", files: ["handle.md"] }),
  [`${TODO_PATH}/handle.md`]: "待办契约",
  ...extra,
});

function installed(dir, v) {
  mkdirSync(join(dir, "hx-aioa"), { recursive: true });
  writeFileSync(join(dir, "hx-aioa", "SKILL.md"), `核心 ${v}`);
}

test("X-Aioa-Want 只差小号: 带上已装版本, 命令结束前自动从 Git (镜像) 重装", async () => {
  const raw = await rawServer(skillFiles("1.1"));
  const srv = await api("setup=1,hx-aioa@1.1,hengxin666.todo@1.0", brief("1.1"));
  const sk = mkdtempSync(join(tmpdir(), "skills-"));
  installed(sk, "1.0");
  const dir = home({ skill: { setup: 1, skills: { "hx-aioa": "1.0", "hengxin666.todo": "1.0" }, dir: sk } });
  try {
    const r = await run(dir, srv.base, ["me"], { HXAIOA_GIT_BASE: raw.base });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /skill 已自动更新到 hx-aioa@1\.1, hengxin666\.todo@1\.0, 下一轮生效/);
    assert.equal(srv.reqs[0].headers["x-aioa-skill"], "setup=1,hx-aioa@1.0,hengxin666.todo@1.0");
    assert.equal(readFileSync(join(sk, "hx-aioa", "SKILL.md"), "utf8"), "核心 1.1");
    assert.equal(readFileSync(join(sk, "hx-aioa", "steps", "2-handle", "impl", "hengxin666.todo.md"), "utf8"), "待办契约");
    assert.equal(readJsonFile(join(dir, "config.json")).skill.skills["hx-aioa"], "1.1");
    assert.equal(readJsonFile(join(dir, "config.json")).skill.setup, 1);
    assert.deepEqual(readdirSync(sk), ["hx-aioa"]);
  } finally {
    await srv.close();
    await raw.close();
  }
});

test("X-Aioa-Want 大号不同: 只打印固定提示, 不下载; auto 时提示 upgrade", async () => {
  const raw = await rawServer(skillFiles("2.0"));
  const sk = mkdtempSync(join(tmpdir(), "skills-"));
  installed(sk, "1.0");
  const cfg = { skill: { setup: 1, skills: { "hx-aioa": "1.0" }, dir: sk } };
  for (const [want, expect] of [
    ["setup=2,hx-aioa@2.0", /^大更新, 需要重新接入 \(接入 2, hx-aioa@2\.0\): 不要自己安装, 在群里告诉主人$/m],
    ["setup=2,hx-aioa@2.0,auto", /^大更新: 运行 hxaioa upgrade$/m],
  ]) {
    const srv = await api(want, brief("2.0"));
    const dir = home(cfg);
    try {
      const r = await run(dir, srv.base, ["me"], { HXAIOA_GIT_BASE: raw.base });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, expect);
      assert.equal(srv.reqs.filter((q) => q.path.endsWith("/next")).length, 0);
      assert.equal(readJsonFile(join(dir, "config.json")).skill.skills["hx-aioa"], "1.0");
    } finally {
      await srv.close();
    }
  }
  assert.equal(raw.reqs.length, 0);
  assert.equal(readFileSync(join(sk, "hx-aioa", "SKILL.md"), "utf8"), "核心 1.0");
  await raw.close();
});

test("skill install: 下载到一半失败不破坏旧目录, 成功时原子替换并记下 setup", async () => {
  const broken = skillFiles("1.1");
  delete broken[`${SKILL_PATH}/steps/1-next/index.md`];
  const raw = await rawServer(broken);
  const srv = await api("setup=3,hx-aioa@1.1", brief("1.1"));
  const sk = mkdtempSync(join(tmpdir(), "skills-"));
  installed(sk, "1.0");
  const dir = home({});
  try {
    const bad = await run(dir, srv.base, ["skill", "install", "--setup", "3", "--dir", sk], { HXAIOA_GIT_BASE: raw.base });
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /下载失败/);
    assert.equal(readFileSync(join(sk, "hx-aioa", "SKILL.md"), "utf8"), "核心 1.0");
    assert.deepEqual(readdirSync(sk), ["hx-aioa"]);
    assert.equal(readJsonFile(join(dir, "config.json")).skill, undefined);

    Object.assign(broken, skillFiles("1.1"));
    const ok = await run(dir, srv.base, ["skill", "install", "--setup", "3", "--dir", sk], { HXAIOA_GIT_BASE: raw.base });
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /hx-aioa@1\.1, hengxin666\.todo@1\.0 \(接入版本 3\)/);
    assert.equal(readFileSync(join(sk, "hx-aioa", "SKILL.md"), "utf8"), "核心 1.1");
    assert.ok(existsSync(join(sk, "hx-aioa", "manifest.json")));
    assert.deepEqual(readdirSync(sk), ["hx-aioa"]);
    const rec = readJsonFile(join(dir, "config.json")).skill;
    assert.equal(rec.setup, 3);
    assert.equal(rec.dir, sk);
    assert.equal(srv.reqs.find((q) => q.path.endsWith("/next")).query.brief, "");
  } finally {
    await srv.close();
    await raw.close();
  }
});

test("清单里的路径不安全就拒绝, 不写目录外的文件", async () => {
  const files = skillFiles("1.1");
  files[`${SKILL_PATH}/manifest.json`] = JSON.stringify({ name: "hx-aioa", version: "1.1", files: ["../evil.md"] });
  const raw = await rawServer(files);
  const srv = await api("setup=1,hx-aioa@1.1", brief("1.1"));
  const sk = mkdtempSync(join(tmpdir(), "skills-"));
  try {
    const r = await run(home({}), srv.base, ["skill", "install", "--dir", sk], { HXAIOA_GIT_BASE: raw.base });
    assert.equal(r.code, 1);
    assert.match(r.stderr, /不安全的路径/);
    assert.deepEqual(readdirSync(sk), []);
  } finally {
    await srv.close();
    await raw.close();
  }
});
