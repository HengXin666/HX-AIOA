# 实时指标 (懒更新)

CPU, 内存这类指标只在有人看时才需要实时, 所以采用懒更新, 服务端不落库。调研其它方案见 #11。

## 流程

1. 探针 (`tools/probe.mjs`) 以 `device=probe-<主体>` 连上 `/ws`, 发 `offer` 声明能提供的主体; 平时只每分钟在本地记一个点 (保留 24 小时)。
2. 客户端打开页面时发 `watch` (主体列表), 离开页面或进入后台时发空列表; 连接断开等同于空列表。
3. Hub 汇总所有 `watch`, 只在某个探针的需求变化时下发 `demand`。
4. 探针收到包含自己的 `demand` 后先发一次本地历史 (`history: true`), 再每 `intervalMs` 推一个点; 需求清空就停。
5. Hub 只转发给在看这个主体的连接, 内存里缓存最后一个点, 新开始看时先给它。

空闲时探针那条连接只有 ping/pong (自动应答, 不唤醒 DO), 不消耗额度; 全程不写 SQLite。
告警在探针本地判断, 需要时走现有 `/api/send` 消息推送。

## 帧

| 方向 | 帧 | 说明 |
| --- | --- | --- |
| 客户端 → Hub | `{t:"watch", subjects}` | 当前在看的主体, 整体替换 |
| 探针 → Hub | `{t:"offer", subjects}` | 能提供的主体 |
| 探针 → Hub → 客户端 | `{t:"metric", subject, points:[{ts, values}], history?}` | 指标点, values 为 名字 → 数值 |
| Hub → 探针 | `{t:"demand", subjects, intervalMs}` | 需要实时推送的主体, 空表示停 |
| Hub → 客户端 | `{t:"probes", subjects}` | 在线探针的主体列表, 连上时发一次, 变化时再发 |

定义在 `protocol/src/index.ts`, 安卓镜像在 `Frames.kt`。

## 运行探针

```bash
AIOA_SERVER=https://你的域名 AIOA_TOKEN=... AIOA_SUBJECT=nas-01 node tools/probe.mjs
```

需要 Node 22 以上。目前采集 cpu, mem, load, temp (有温度传感器时)。

## 本地联调

```bash
cd server && echo "AUTH_TOKEN=devtoken" > .dev.vars && npx wrangler dev --port 8787
AIOA_SERVER=http://localhost:8787 AIOA_TOKEN=devtoken AIOA_SUBJECT=nas-01 node tools/probe.mjs
cd client/android && AIOA_SERVER=http://localhost:8787 AIOA_TOKEN=devtoken AIOA_SUBJECT=nas-01 ./gradlew :gallery:run -PdesktopOnly=true
```

画廊设置了这三个环境变量就显示真数据, 否则用模拟数据。

## 安卓

聊天页顶部 "资源" 进入资源页。页面可见时通过界面进程那条前台连接 watch 所有在线探针, 返回或切到后台 (连接断开) 即取消; 后台 :link 进程不参与指标, 不增加耗电。
