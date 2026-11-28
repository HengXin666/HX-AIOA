# 安卓后台耗电: 测量方法与改动记录 (#8)

目标: 同等使用条件下连续两天后台耗电 ≤2%, 推送延迟仍 ≤3 秒, 连接日志无异常断线。

先测量再改。每项改动都要有前后对比数据, 填进文末的表格。

## 1. 代码层面的改动 (本轮)

| 耗电点 | 改之前 | 改之后 |
| --- | --- | --- |
| 心跳 | OkHttp 协议 ping 每 60 秒 + 看门狗文本 ping 每 5 分钟, 两套心跳并存 | `:link` 关掉 OkHttp ping, 只由看门狗闹钟发文本 `ping` (服务端 `setWebSocketAutoResponse` 自动回 `pong`, 不唤醒 DO); 最近有流量就不发探测 |
| 看门狗间隔 | 固定 5 分钟闹钟 | 曾按 NAT 自适应 4-14 分钟; #149 起改回固定 5 分钟 (`WATCHDOG_INTERVAL_MS`), 见下方 "CF 边缘 100 秒回收" |
| 醒着时保活 (#149) | 无, 两次闹钟之间连接空着 | `:link` 空闲 80 秒发一次文本 `ping` (`LINK_KEEPALIVE_MS`), Handler 计时, 深睡时停走, 不新增唤醒; 空闲已超过 100 秒的不发也不重连, 交给看门狗 |
| 补拉提醒 (#149) | 重连补拉 (seq <= welcome.head) 的事件只入库不提醒 | 不是首次同步, 不是 resync, 6 小时内的照常提醒, 每次重连最多 20 条 |
| 唤醒锁 | 每次闹钟固定持有 10 秒 | 收到 `pong` 或判定有流量立即释放 (通常几百毫秒); 只有离线需要重连时才持有到超时 |
| 额外触发 | 无 | 亮屏 (`ACTION_SCREEN_ON`, 较久没流量才探测) 与网络变化 (`NetworkCallback`) 时检查, 这些时刻 CPU 本来就醒着 |
| 代理内核 mihomo | 只要配了订阅就常驻 | "消息长连接也走代理" 开着时常驻 (长连接需要它); 关着时按需启动 (检查更新失败重试, 下载安装包, 打开设置页), 空闲 5 分钟且没有活动连接就停掉 |
| 节点测速 | 每小时测全部节点 | 不再定时: 内核启动时测一次, 长连接断开时 (10 秒防抖) 测, 内核持续运行超过 6 小时后的下一次按需使用时再测 |
| 更新检查与订阅刷新 | 更新每 6 小时一个 Handler 定时器, 订阅每小时检查是否过期 | 合并为一次 "维护": 不设闹钟, 搭看门狗闹钟, 亮屏, 网络变化这些已有的唤醒, 距上次超过 6 小时才跑; 订阅超过 24 小时才下载, 内核没在跑时只下文件不拉起内核 |
| 日志 | 每写一行都读全文件判断是否裁剪 | 按文件大小判断, 平时只追加 |
| 计数 | 无 | `LinkStats`: 建连, 断线, 闹钟唤醒, 亮屏检查, 网络变化, 心跳探测, 有流量免探测, 探测判死, 维护, 内核启动 / 停止, 节点测速; 搭唤醒落盘, 在 设置 → 连接日志 第一行查看 |

| presence 空推 (2026-11-25) | 服务端把 "谁在监听 / 输入" 帧推给所有客户端连接, 含 `:link`; 一个每 20 秒拉取的 Agent 约每 40 秒续期一次, 后台连接全天被唤醒, `:link` 收到后直接丢弃 | 设备 id 以 `android-link-` 开头的连接不推 presence, 连上时也不补发 (服务端改动, 旧版 App 同样生效) |
| 界面连接 | 切到后台立即断开, 每次打开 App 重新建连并显示 "连接中" | 切走后保留 90 秒 (`UI_LINGER_MS`), 短时间切回不重连; 保留期间收到的消息只入库, 不算已读 |
| 调试模式 | 只有计数摘要与日志 | 设置 → 调试模式: 今天后台 / 界面连接的尝试与连上次数 (后台连接再分 App 是否打开), 近 24 小时整机亮屏 / 熄屏每小时掉电 (`BatteryLog`, 搭已有唤醒采样), 后台收帧与其中用不到的帧计数; 开 "详细记录" 后每帧记一行 |

相关常量都在 `client/android/app/src/main/java/com/hengxin/aioa/Constants.kt` (`EDGE_IDLE_MS`, `LINK_KEEPALIVE_MS`, `WATCHDOG_INTERVAL_MS`, `WATCHDOG_WAKE_MS`, `RECONNECT_*`, `PROXY_IDLE_STOP_MS`, `PROXY_OPTIMIZE_MAX_AGE_MS`, `UPDATE_INTERVAL_MS`), 决策逻辑在 `link/LinkPolicy.kt`。

CF 边缘 100 秒回收 (#149): CF 对 WebSocket 约 100 秒双向无数据就关掉 TCP (不带关闭帧, 客户端读到 EOFException)。原先 4-14 分钟的自适应心跳按 NAT 估, 远超 100 秒, debug 群 36.6 小时记到 196 次后台 EOF, 每次闹钟唤醒都读到。深睡时闹钟最短间隔是分钟级 (系统配额加厂商对齐), 100 秒内的心跳做不到, 所以深睡时每次闹钟重连一次并补拉提醒, 最大延迟约等于闹钟间隔; 醒着时靠 80 秒保活不断。空闲超过 100 秒后读到的关闭记为 "空闲回收" (`LinkStats` 单独计数), 不进失败转发。

## 2. 测量步骤

以下命令在电脑上执行, 手机用 USB 连接并打开 USB 调试。包名 `com.hengxin.aioa`。

### 2.1 准备

```bash
# 充满电后拔掉 USB 供电影响: 先清空统计, 再断开 USB 用 Wi-Fi 调试, 或者测完再插回来导出
adb shell dumpsys batterystats --reset
adb shell dumpsys batterystats --enable full-wake-history

# 记下当前 App 内计数 (设置 → 连接日志 第一行), 作为起点
```

测量期间手机正常使用但不打开 HX-AIOA, 保持网络环境一致 (同一个 Wi-Fi 或同一张卡), 每次至少 24 小时, 目标两天。

用服务端定时发消息模拟真实推送, 并记录每条的送达延迟:

```bash
node tools/bench.mjs   # 用法见脚本头部, 结果里的 p50 / p95 / max 填进表格
```

### 2.2 导出与拆分

```bash
# 只看本应用 (uid) 的耗电拆分: CPU 时间, 唤醒锁, 闹钟, 网络, 移动网络活跃时间
adb shell dumpsys batterystats --charged com.hengxin.aioa > aioa-stats.txt

# 唤醒闹钟次数, 按 Intent 拆分 (看门狗是 com.hengxin.aioa.WATCHDOG)
adb shell dumpsys alarm | grep -A3 "com.hengxin.aioa"

# 唤醒锁明细 (aioa:watchdog, aioa:maintenance 两个标签)
grep -E "Wake lock|aioa:" aioa-stats.txt

# 进程内存 (:link 进程应该很小)
adb shell dumpsys meminfo com.hengxin.aioa:link | head -30
adb shell ps -A -o PID,RSS,NAME | grep -E "aioa|mihomo"

# 代理内核子进程是否在跑 (按需模式下大多数时间应该不在)
adb shell "ps -A | grep libmihomo"
```

`aioa-stats.txt` 里重点看:

- `Estimated power use` 中本应用 uid 那一行 (mAh)。
- `Wake lock aioa:watchdog` / `aioa:maintenance`: 次数与总时长。
- `Wakeup alarm *walarm*:com.hengxin.aioa.WATCHDOG`: 闹钟唤醒次数。
- `Mobile network` / `Wi-Fi network`: 收发字节与包数; `Mobile radio active`: 射频活跃时间。
- `Foreground service` 时长与 `Total cpu time` (`u=` 用户态, `s=` 内核态)。

### 2.3 Battery Historian (可视化时间线)

```bash
adb bugreport bugreport.zip

# 用 Docker 跑 Battery Historian, 浏览器打开 http://localhost:9999 上传 bugreport.zip
docker run -p 9999:9999 gcr.io/android-battery-historian/stable:3.1 --port 9999
```

在 App Selection 里选 `com.hengxin.aioa`, 对照时间线看: 每次唤醒是闹钟 (`WATCHDOG`) 还是网络包, 唤醒锁持有多久, 射频活跃段是否与心跳对齐, `libmihomo.so` 子进程的 CPU 占用出现在哪些时段。

### 2.4 归类

| 类别 | 从哪里看 |
| --- | --- |
| 长连接 | 心跳探测次数 (App 计数), `aioa:watchdog` 唤醒锁, `WATCHDOG` 闹钟次数, 网络包数 |
| 代理内核 | `libmihomo.so` 进程 CPU 时间, App 计数里的内核启动 / 停止与节点测速次数 |
| 定时任务 | `aioa:maintenance` 唤醒锁次数与时长, App 计数里的维护次数 |

## 3. 前后对比表

每次测量填一行, 改动前的基线也要测。

| 日期 | 版本 | 网络 | 时长 (h) | 系统耗电占比 | 本应用 mAh | 闹钟唤醒 | watchdog 唤醒锁 (次 / 总时长) | maintenance 唤醒锁 | 射频活跃 (min) | CPU 时间 (s) | 内核运行时长 | 心跳间隔学到 (min) | 推送延迟 p50 / p95 / max (ms) | 异常断线 | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | 改动前基线 | | | 约 5% | | | | | | | | 5 (固定) | | | |
| | 本轮改动 | | | | | | | | | | | | | | |

App 内计数 (设置 → 连接日志第一行) 在测量开始与结束各记一次, 两次之差填进下表, 用来和 batterystats 互相印证。

| 版本 | 建连 | 断线 | 闹钟唤醒 | 亮屏检查 | 网络变化 | 心跳探测 | 有流量免探测 | 探测判死 | 维护 | 内核启动 | 内核停止 | 节点测速 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | | | | |

## 4. 还没做的

- 息屏且长时间无消息时更多依赖 MiPush 系统通道 (需要先接入 MiPush SDK 与服务端兜底推送)。
- 深睡时的秒级推送: 受 CF 100 秒回收与闹钟配额所限, 长连接做不到, 只能靠系统推送通道 (上一条)。

## 调试模式的监听 (#111)

"我的 → 连接 → 长连接记录" 里每项单独开关, 默认都关:

- 记录收帧: 后台连接每收到一帧记一行 (`link_log.txt`)。
- 记录请求: 每个 HTTP 请求记方法, 路径, 状态, 耗时 (`http_log.txt`, OkHttp 拦截器, 关着时只多一次文件存在判断)。
- 失败转发到群: 失败的请求 (4xx / 5xx / 网络异常) 和长连接断线 / 失败事件攒进 `debug_outbox`, 只由后台 `:link` 进程搭看门狗闹钟合成一条消息发到指定群 (默认 `debug`), 发送时先把待发文件改名成快照, 发失败留着下次再发。转发自己的请求不记; 外部地址 (如 Telegram, 路径里带令牌) 只记主机名。

电量与连接计数 (`BatteryLog`, `LinkStats`) 不论开关都在记, 只搭已有唤醒, 页面上 "近 24 小时耗电" 按亮屏 / 熄屏分开算每小时掉电, 用来量化长连接的耗电。
