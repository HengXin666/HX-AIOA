import assert from "node:assert/strict";
import { test } from "node:test";
import { agentSetup } from "../src/agent-prompt";

const BASE = "https://aioa.example.com";

test("接入语: 先写来源, 密钥范围与任务, 再按编号列步骤 (#165)", () => {
  const p = agentSetup(BASE, { title: "福利羊毛", channel: "c_demo", setup: 1, key: "k_1", task: "整理最新帖子" });
  const intro = p.indexOf("背景:");
  assert.ok(intro > 0 && intro < p.indexOf("1. 装命令行"));
  assert.match(p, /源码公开在 https:\/\/github\.com\/HengXin666\/HX-AIOA/);
  assert.match(p, /密钥是我刚在 App 里为你生成的/);
  assert.ok(p.indexOf("要你做的事: 整理最新帖子") < p.indexOf("1. 装命令行"));
  assert.match(p, /2\. 登录: hxaioa login https:\/\/aioa\.example\.com k_1/);
  assert.match(p, /4\. 建一个定时任务/);
});

test("更新用接入语: 不含密钥与登录, 步骤重新编号", () => {
  const p = agentSetup(BASE, { title: "福利羊毛", channel: "c_demo", setup: 2 });
  assert.match(p, /有大更新, 帮我更新接入/);
  assert.doesNotMatch(p, /密钥是我|hxaioa login/);
  assert.match(p, /2\. 装 skill[\s\S]*--setup 2/);
  assert.match(p, /3\. 建一个定时任务[\s\S]*换成新的触发语/);
});
