import assert from "node:assert/strict";
import { test } from "node:test";
import { SETUP_TASK_MARK } from "@hx-aioa/protocol";
import { agentSetup, agentTrigger } from "../src/agent-prompt";

const BASE = "https://aioa.example.com";

test("接入语: 先写来源与密钥范围, 任务单独一段, 再按编号列步骤 (#165)", () => {
  const p = agentSetup(BASE, { title: "福利羊毛", channel: "c_demo", setup: 1, key: "k_1", task: "整理最新帖子" });
  assert.ok(p.indexOf("背景:") < p.indexOf(SETUP_TASK_MARK));
  assert.ok(p.indexOf(SETUP_TASK_MARK) < p.indexOf("1. 装命令行"));
  assert.match(p, /源码公开在 https:\/\/github\.com\/HengXin666\/HX-AIOA/);
  assert.match(p, /\n\n整理最新帖子\n\n/, "任务前后空行, 一眼能看到");
  assert.match(p, /2\. 登录: hxaioa login https:\/\/aioa\.example\.com k_1/);
  assert.match(p, /4\. 建一个定时任务, 内容照抄下面这段/);
  assert.match(p, /\n用 hx-aioa skill 处理群 "福利羊毛" \(c_demo\) 一轮。每轮任务: 整理最新帖子\n/);
  assert.doesNotMatch(p, /触发语/, "不对主人说触发语");
});

test("接入语: 没写任务时留醒目的占位, 定时内容指回那一段", () => {
  const p = agentSetup(BASE, { title: "福利羊毛", channel: "福利羊毛", setup: 1, key: "k_1" });
  assert.match(p, /<发出前把这一行换成你的任务/);
  assert.match(p, new RegExp(`每轮任务: <上面 "${SETUP_TASK_MARK}" 的原文>`));
});

test("定时内容: 群名就是 channel 时不重复; 开了自动大更新带授权", () => {
  assert.equal(agentTrigger("福利羊毛", "福利羊毛"), "用 hx-aioa skill 处理群 \"福利羊毛\" 一轮。");
  assert.equal(agentTrigger("群", "c1", true, "看帖"), "用 hx-aioa skill 处理群 \"群\" (c1) 一轮。遇到大更新直接运行 hxaioa upgrade。每轮任务: 看帖");
});

test("更新用接入语: 不含密钥, 登录与任务段, 保留原来的任务", () => {
  const p = agentSetup(BASE, { title: "福利羊毛", channel: "c_demo", setup: 2 });
  assert.match(p, /有大更新, 帮我更新接入/);
  assert.doesNotMatch(p, /密钥是我|hxaioa login/);
  assert.ok(!p.includes(SETUP_TASK_MARK));
  assert.match(p, /2\. 装 skill[\s\S]*--setup 2/);
  assert.match(p, /3\. 把原来那个定时任务的内容换成下面这段[\s\S]*每轮任务: <原来定时任务里写的任务, 原样保留>/);
});
