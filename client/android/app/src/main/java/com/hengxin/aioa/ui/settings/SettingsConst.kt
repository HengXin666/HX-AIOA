package com.hengxin.aioa.ui.settings

const val ICON_CHEVRON = "chevron-down"
const val ICON_CHECK = "check"
const val ICON_REFRESH = "refresh-cw"
const val TEXT_SHOW = "显示"
const val TEXT_HIDE = "隐藏"
const val TEXT_REFRESH = "刷新"
const val TEXT_ON = "已开启"
const val TEXT_OFF = "已关闭"
const val TEXT_DIRECT = "直连"
const val TEXT_STATUS = "状态"
const val TEXT_ALLOWED = "已允许"
const val TEXT_NOT_ALLOWED = "未允许"

/** "我的" 下的页面; ROOT 是分组列表, 其余每项一个独立子页, 父页都是 ROOT。 */
enum class SettingsPage(val title: String, val icon: String) {
    ROOT("我的", "user"),
    ACCOUNT("账号", "user"),
    MEMBERS("成员与邀请", "user"),
    SOURCES("数据源", "send"),
    INTEGRATIONS("接入总览", "bot"),
    SERVER("服务端", "server"),
    PROXY("代理", "plug"),
    LINK_LOG("连接日志", "file-text"),
    NOTIFY("通知设置", "bell"),
    APPEARANCE("外观", "palette"),
    SYSTEM("系统权限", "shield-check"),
    CF_USAGE("CF 额度", "gauge"),
    UPDATE("更新", ICON_REFRESH),
    ABOUT("关于", "bot"),
}

/** 工作台在 "资源" 页, 这里只是入口, 不是子页。 */
const val WORKSPACE_TITLE = "工作台与组件"
const val WORKSPACE_ICON = "layout-dashboard"
