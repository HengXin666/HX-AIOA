package com.hengxin.aioa.ui.chat

import androidx.compose.runtime.mutableStateMapOf
import com.hengxin.aioa.data.Me
import com.hengxin.aioa.proto.ServerFrame

/**
 * 来源的当前名字: 消息里存的是发送那一刻的名字快照, 显示时按来源 id 取最新的,
 * 这样 Agent 改名后历史消息也跟着变; 查不到 (已删除的来源) 再用快照。
 * 优先级: 主人给系统发送者起的别名 > 群资料里群 Agent 的名字 > 来源名 > 快照。
 */
object Names {
    private val names = mutableStateMapOf<String, String>()
    private val agents = mutableStateMapOf<String, String>()

    fun update(next: Map<String, String>) {
        next.forEach { (id, name) -> if (name.isNotEmpty() && names[id] != name) names[id] = name }
    }

    /** 各群资料里的群 Agent: 来源 id → 主人起的名字; 整体替换 (删掉的 Agent 不再算)。 */
    fun agents(next: Map<String, String>) {
        agents.keys.filter { it !in next }.forEach { agents.remove(it) }
        next.forEach { (id, name) -> if (agents[id] != name) agents[id] = name }
    }

    fun isAgent(sid: String?): Boolean = sid != null && sid in agents

    fun ofSid(sid: String?, fallback: String): String =
        Senders.aliasOf(sid) ?: sid?.let { agents[it]?.ifEmpty { null } ?: names[it] } ?: fallback

    fun of(msg: ServerFrame.Msg): String = if (msg.mine) Me.label else ofSid(msg.sid, msg.src)
}
