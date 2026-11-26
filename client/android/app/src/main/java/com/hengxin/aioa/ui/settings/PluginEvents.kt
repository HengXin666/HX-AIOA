package com.hengxin.aioa.ui.settings

import com.hengxin.aioa.proto.Compat
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** 插件相关界面的刷新信号: 收到 plugin_update 就加一, 插件页与详情页据此重拉; 握手档位也放这里。 */
object PluginEvents {
    private val _rev = MutableStateFlow(0L)
    val rev: StateFlow<Long> = _rev
    private val _compat = MutableStateFlow<Compat?>(null)
    val compat: StateFlow<Compat?> = _compat

    fun bump() {
        _rev.value += 1
    }

    fun setCompat(c: Compat?) {
        _compat.value = c
    }
}
