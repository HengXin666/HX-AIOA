# 安卓: 内置浏览器

App 里所有网页链接都在内置浏览器打开, 不再跳外部浏览器。代码在 `client/android/app/src/main/java/com/hengxin/aioa/browser/`。

## 入口

- 统一走 `Browser.open(context, url)`: `http(s)` 进内置浏览器, 其他协议 (`mailto:`, App 协议等) 交给系统。
- 文本里的链接 (Markdown) 由 `MainActivity` 根部的 `LocalUriHandler` 接管; 通知点开, 事件详情 "打开链接", GitHub 页面, 数据源接入页, HTML 卡片里的链接都已改走这里。
- 新加打开链接的地方不要再直接 `ACTION_VIEW`, 用 `Browser.open`。

## 行为

- 系统 WebView, 单个 `BrowserActivity` (`singleTop`): 浏览器开着时新链接在同一个页面里打开, 返回键先后退页面历史。
- 登录态: 所有 WebView 共用一份 Cookie 与本地存储, 持久保存, 重启 App 也在; 允许第三方 Cookie, 方便 OAuth 登录。
- UA 去掉 WebView 标记 `; wv`, 站点按普通手机 Chrome 对待。Google 账号登录仍可能拒绝内嵌浏览器, 遇到时点右下角用外部浏览器打开。
- 代理: 配了订阅就用 `androidx.webkit` 的 `ProxyController` 把本进程 WebView 指向内置 mihomo (`127.0.0.1:17890`), 规则后面跟 DIRECT, 内核不通时自动直连。分流由订阅规则决定。打开浏览器时按需拉起内核 (`ProxyDemand.ensure`), 回到前台或开始新导航时内核若已空闲停掉就再拉起。底栏显示 "代理" 或 "直连"。
- 广告: 拦截常见广告 / 统计域名的第三方请求 (`BrowserRules.AD_HOSTS`), 页面自身站点不拦; 底栏显示本页拦截数。页面自动跳转到其他 App 的协议一律忽略, 只有用户点击才拉起。
- 地址栏: 不编辑时显示 "域名 | 标题", 点开显示完整地址并全选; 输入像网址就打开, 否则用 Bing 搜索。
- 其他: 刷新 / 停止, 前进后退, 复制链接, 外部浏览器打开, 文件上传 (系统选择器), 下载交给系统下载管理器 (带本站 Cookie, Android 10+)。

## 不做

- 多标签, 书签, 历史记录页; 需要时再加。
