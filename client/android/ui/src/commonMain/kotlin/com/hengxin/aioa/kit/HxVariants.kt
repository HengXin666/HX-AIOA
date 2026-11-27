package com.hengxin.aioa.kit

// 由 tools/hx-ui-gen.mjs 从 design/hx-ui/ (HX-UI 锁定版本) 生成, 请勿手改
// HX-UI 新增变体时这里多出枚举值, 用到它的 when 不再穷尽, 编译就会提醒补实现。

/** HX-UI alert 的 variant。 */
enum class HxAlertVariant(val key: String) {
    Default("default"),
    Info("info"),
    Success("success"),
    Warning("warning"),
    Destructive("destructive"),
}

/** HX-UI badge 的 variant。 */
enum class HxBadgeVariant(val key: String) {
    Default("default"),
    Secondary("secondary"),
    Destructive("destructive"),
    Outline("outline"),
    Ghost("ghost"),
    Link("link"),
}

/** HX-UI button 的 variant。 */
enum class HxButtonVariant(val key: String) {
    Default("default"),
    Destructive("destructive"),
    Outline("outline"),
    Secondary("secondary"),
    Ghost("ghost"),
    Link("link"),
    Shimmer("shimmer"),
}

/** HX-UI button 的 size。 */
enum class HxButtonSize(val key: String) {
    Default("default"),
    Xs("xs"),
    Sm("sm"),
    Lg("lg"),
    Icon("icon"),
    IconXs("icon-xs"),
    IconSm("icon-sm"),
    IconLg("icon-lg"),
}

/** HX-UI input 的 size。 */
enum class HxInputSize(val key: String) {
    Sm("sm"),
    Default("default"),
    Lg("lg"),
}

/** HX-UI track 的 size。 */
enum class HxTrackSize(val key: String) {
    Sm("sm"),
    Default("default"),
    Lg("lg"),
}

/** HX-UI sidebarMenuButton 的 variant。 */
enum class HxSidebarMenuButtonVariant(val key: String) {
    Default("default"),
    Outline("outline"),
}

/** HX-UI sidebarMenuButton 的 size。 */
enum class HxSidebarMenuButtonSize(val key: String) {
    Default("default"),
    Sm("sm"),
    Lg("lg"),
}

/** HX-UI tabsList 的 variant。 */
enum class HxTabsListVariant(val key: String) {
    Default("default"),
    Line("line"),
}

/** HX-UI toggle 的 variant。 */
enum class HxToggleVariant(val key: String) {
    Default("default"),
    Outline("outline"),
}

/** HX-UI toggle 的 size。 */
enum class HxToggleSize(val key: String) {
    Default("default"),
    Sm("sm"),
    Lg("lg"),
}
