package com.hengxin.aioa.ui.chat

import androidx.compose.runtime.mutableStateMapOf
import com.hengxin.aioa.data.Me
import com.hengxin.aioa.proto.ServerFrame

/**
 * 来源的当前名字: 消息里存的是发送那一刻的名字快照, 显示时按来源 id 取最新的,
 * 这样 Agent 改名后历史消息也跟着变; 查不到 (已删除的来源) 再用快照。
 */
object Names {
    private val names = mutableStateMapOf<String, String>()

    fun update(next: Map<String, String>) {
        next.forEach { (id, name) -> if (name.isNotEmpty() && names[id] != name) names[id] = name }
    }

    fun of(msg: ServerFrame.Msg): String = if (msg.mine) Me.label else msg.sid?.let { names[it] } ?: msg.src
}
