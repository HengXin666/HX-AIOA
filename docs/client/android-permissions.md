# 安卓权限清单

当前 targetSdk 35, compileSdk 36, minSdk 26。加 / 删权限, 或改了申请时机, 同步改这份表和 "我的 → 系统权限" 页。

原则:

1. **用到再要**: 运行时权限在用户第一次用到相关功能时申请, 先用一句话说明为什么; 不在启动时一次全要。
2. **能不要就不要**: 选图用系统照片选择器, 存文件用系统 "另存为" (SAF), 扫码优先系统扫码, 这些都不需要权限。
3. **被拒后**: 功能降级并说明, 在 "系统权限" 页给 "去设置" 入口; 不反复弹。
4. **都能看到**: "我的 → 系统权限" 列出每一项的状态, 回到前台时重读。

## 1. 现有权限

| 权限 | 类型 | 用途 | 何时申请 / 现状 | 结论 |
| --- | --- | --- | --- | --- |
| INTERNET | 普通 | 连服务端, 代理内核 | 安装即有 | 保留 |
| ACCESS_NETWORK_STATE | 普通 | 断网 / 切网时重连长连接 | 安装即有 | 保留 |
| POST_NOTIFICATIONS | 运行时 (13+) | 新消息, Agent 确认, 告警 | **每次冷启动都在 onCreate 里申请** | 改: 登录成功后, 或第一次进群 / 打开通知设置时, 先说明再申请; 拒绝两次后只在系统权限页给入口 |
| FOREGROUND_SERVICE + FOREGROUND_SERVICE_SPECIAL_USE | 普通 (14+ 要类型) | `:link` 进程长连接 (specialUse, 已写说明) | 安装即有 | 保留; 侧载不受商店审核影响, 上架需换方案 (FCM / 厂商推送) |
| FOREGROUND_SERVICE_DATA_SYNC | 普通 (14+ 要类型) | 头像上传期间的 `TransferService` (界面进程, 传完即停, 通知显示进度, #125) | 安装即有; 只在用户点上传时起服务 | 保留; 头像最多 60KB, 不值得为 14+ 的 RUN_USER_INITIATED_JOBS 分版本, 大文件仍按第 2 节 |
| RECEIVE_BOOT_COMPLETED | 普通 | 开机 / 更新后拉起长连接 | 安装即有 | 保留 |
| WAKE_LOCK | 普通 | 收消息时短暂保持 CPU | 安装即有 | 保留, 确认都有超时 |
| REQUEST_IGNORE_BATTERY_OPTIMIZATIONS | 特殊 | 加电池白名单, 后台不断线 | 系统权限页手动点; MIUI 跳省电策略页 | 保留 |
| VIBRATE | 普通 | 通知震动 | 安装即有 | 保留 |
| REQUEST_INSTALL_PACKAGES | 特殊 ("安装未知应用") | 应用内更新 | 第一次装更新时引导; 系统权限页有入口 | 保留 |
| UPDATE_PACKAGES_WITHOUT_USER_ACTION | 普通 (12+) | 自己装过的包静默更新 | 安装即有 | 保留 |

不需要权限但要注意的:

| 能力 | 做法 | 说明 |
| --- | --- | --- |
| 选头像 | PickVisualMedia | 系统照片选择器, 不要 READ_MEDIA_* |
| 发文件 | GetContent | 同上 |
| 附件缓存 | App 私有目录 + FileProvider | 没有 "保存到下载"; 要做就用 SAF `CreateDocument` |
| 剪贴板 | 只写; 终端粘贴时才读 | 不要自动读剪贴板 (12+ 会弹 "已粘贴" 提示) |
| 内置浏览器 | WebView, onShowFileChooser 已接 | 网页要相机 / 麦克风时目前直接拒绝, 保持 |
| 明文 HTTP | 只放行 127.0.0.1 / localhost (代理内核) | 保持 |
| 精确闹钟 | 看门狗用 setAndAllowWhileIdle (不精确) | 不需要 SCHEDULE_EXACT_ALARM |

## 2. 规划功能会用到的

| 功能 (issue 清单) | 权限 | 类型 | 建议 |
| --- | --- | --- | --- |
| 连局域网里的服务端 / 探针 / hxoa | 局域网访问 (Android 16 起分阶段收紧, 目前用 NEARBY_WIFI_DEVICES 测试) | 运行时 | 先在 16 上打开兼容开关 `RESTRICT_LOCAL_NETWORK` 实测; 只在用户填了内网地址时申请 |
| 待办 / 提醒准点通知 | SCHEDULE_EXACT_ALARM (或 USE_EXACT_ALARM) | 特殊 | 只在用户设了具体时间时申请; 默认用不精确闹钟 |
| 大文件后台上传下载 | RUN_USER_INITIATED_JOBS (14+) | 普通 | 用户点了上传 / 下载才排任务, 通知显示进度; 比再开一个前台服务好 |
| Agent 任务进度常驻通知 | Android 16 进度型通知 (Live Updates); 需要的权限声明实施前再核对 | 普通 | 只给 "进行中" 的任务用 |
| 应用锁 / 看令牌前验证 | USE_BIOMETRIC | 普通 | 可选开关; 令牌, 密钥页同时加 FLAG_SECURE (最近任务里不显示) |
| 扫码加群 / 扫码接入 | CAMERA | 运行时 | 先用系统扫码 (不需要权限); 没有 GMS 的机型再用 CameraX + CAMERA |
| 语音消息 / 语音给 Agent | RECORD_AUDIO | 运行时 | 按住说话时才申请 |
| 分享到 AIOA (发到群 / 交给 Agent / 建待办) | 无 (ACTION_SEND intent-filter) | | 不需要权限 |
| 加入通讯录 / 定位 / 蓝牙 | 不做 | | 不申请 |

## 3. 系统权限页 (我的 → 系统权限) 目标结构

```
通知       状态 · 渠道设置 · 测试通知
后台保活   电池白名单 · 自启动 (MIUI / ColorOS / HarmonyOS 各自入口)
安装       安装未知应用
可选       局域网 · 精确提醒 · 相机 · 麦克风 · 应用锁   (只列已用到的功能)
```

每行: 名称, 为什么要, 当前状态 (已允许 / 未允许 / 不需要), 一个按钮 (申请 或 去设置)。
