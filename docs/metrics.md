# 实时指标 (懒更新)

CPU, 内存这类指标只在有人看时才需要实时, 所以采用懒更新, 服务端不落库。调研其它方案见 #11。

## 流程

1. 探针 (`tools/probe.mjs`) 以 `device=probe-<主体>` 连上 `/ws`, 发 `offer` 声明能提供的主体; 平时只每分钟在本地记一个点 (保留 24 小时)。
2. 客户端打开页面时发 `watch` (主体列表), 离开页面或进入后台时发空列表; 连接断开等同于空列表。
3. Hub 汇总所有 `watch`, 只在某个探针的需求变化时下发 `demand`。
4. 探针收到包含自己的 `demand` 后先发一次本地历史 (`history: true`), 再每 `intervalMs` 推一个点; 需求清空就停。
5. Hub 只转发给在看这个主体的连接, 内存里缓存最后一个点, 新开始看时先给它。

空闲时探针那条连接只有 ping/pong (自动应答, 不唤醒 DO), 不消耗额度; 全程不写 SQLite。
告警在探针本地判断: 每分钟采样, 连续 3 次超限发一条消息 (`src` 为 `probe-<主体>`), 恢复后再发一条, 中间不重复。消息走 `/api/send`, 手机不在线时会走兜底推送; 安卓总览页 "需要我" 显示近 24 小时的告警。

## 帧

| 方向 | 帧 | 说明 |
| --- | --- | --- |
| 客户端 → Hub | `{t:"watch", subjects}` | 当前在看的主体, 整体替换 |
| 探针 → Hub | `{t:"offer", subjects}` | 能提供的主体 |
| 探针 → Hub → 客户端 | `{t:"metric", subject, points:[{ts, values}], history?}` | 指标点, values 为 名字 → 数值 |
| Hub → 探针 | `{t:"demand", subjects, intervalMs}` | 需要实时推送的主体, 空表示停 |
| Hub → 客户端 | `{t:"probes", subjects}` | 在线探针的主体列表, 连上时发一次, 变化时再发 |
| 探针 → Hub | `{t:"host", subject, info, last, avail}` | 主机卡片快照: 连上时和每 10 分钟一次 |
| Hub → 客户端 | `{t:"hosts", hosts}` | 全部主机卡片, 开始 watch 时和快照变化时发给在看的连接 |

定义在 `protocol/src/index.ts`, 安卓镜像在 `Frames.kt`。

### 主机卡片与 CF 额度

- 快照 (主机名, IP, 系统, 核数, 内存 / 磁盘总量, 开机时间, 最新一组指标, 24 小时在线率) 只放在探针那条连接的 attachment 里, 休眠唤醒后仍在, 不写 SQLite。每台探针每天约 144 条消息, 写入为 0。
- 实时推送 (有人在看时每 2 秒) 只转发, 不落库。
- 唯一的写入是探针断开时记一行离线快照, 卡片据此显示 "离线 · 最后在线时间"。
- 在线率由探针本地统计 (每分钟记一次连接是否在线), 不占服务端写入。

## 运行探针

```bash
AIOA_SERVER=https://你的域名 AIOA_TOKEN=... AIOA_SUBJECT=nas-01 node tools/probe.mjs
```

需要 Node 22 以上。目前采集 cpu, mem, disk, load, rx / tx (KB/s), temp (有温度传感器时), 均为标准字段名 (`protocol/src/v1/metric-fields.ts`); Beszel, Netdata, Prometheus 的数据进入服务端时也换成同一套名字, 工作台组件不关心来源。

告警阈值: `AIOA_ALERT_CPU`, `AIOA_ALERT_MEM` (百分比, 默认 90), `AIOA_ALERT_TEMP` (摄氏度, 默认 85), 设为 0 关闭。

## 本地联调

```bash
cd server && echo "AUTH_TOKEN=devtoken" > .dev.vars && npx wrangler dev --port 8787
AIOA_SERVER=http://localhost:8787 AIOA_TOKEN=devtoken AIOA_SUBJECT=nas-01 node tools/probe.mjs
cd client/android && AIOA_SERVER=http://localhost:8787 AIOA_TOKEN=devtoken AIOA_SUBJECT=nas-01 ./gradlew :gallery:run -PdesktopOnly=true
```

画廊设置了这三个环境变量就显示真数据, 否则用模拟数据。

## 安卓

底部 "资源" 进入资源页, "总览" 也显示各探针 CPU。这两页可见时通过界面进程那条前台连接 watch 所有在线探针, 返回或切到后台 (连接断开) 即取消; 后台 :link 进程不参与指标, 不增加耗电。
