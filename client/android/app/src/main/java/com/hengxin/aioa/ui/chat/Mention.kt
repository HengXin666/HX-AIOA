package com.hengxin.aioa.ui.chat

import com.hengxin.aioa.proto.Mentions

/** @ 选择里的一项: token 是发给服务端的记号 (uid / agent:<keyId> / all), label 是插进输入框的名字。 */
data class MentionTarget(val token: String, val label: String, val sub: String, val agent: Boolean = false, val sid: String? = null)

/** @ 的纯运算: 候选列表, 输入框里的查询词, 发送时还留着的记号。 */
object MentionOps {
    const val ALL_LABEL = "全体成员"
    // "@" 要在开头或空白后, 免得输邮箱也弹
    private val QUERY = Regex("(?:^|\\s)@([^\\s@]{0,20})$")

    /** 先全体, 再 Agent, 再真人; 单聊没有全体与 Agent (#133), 自己不在里面。 */
    fun candidates(meta: ChatMeta?, members: List<RoomMember>, me: String?): List<MentionTarget> {
        val dm = meta?.isDm == true
        val all = if (dm || meta == null || !meta.shared) emptyList() else listOf(MentionTarget(Mentions.ALL, ALL_LABEL, "${meta.members} 人"))
        val agents = if (dm) emptyList() else meta?.agents.orEmpty().map { MentionTarget(Mentions.agent(it.keyId), it.name.ifEmpty { it.keyId }, "Agent", agent = true, sid = it.sourceId) }
        val people = members.filter { it.id != me }.map { MentionTarget(it.id, it.display.ifEmpty { it.name }, roleLabel(it.role), sid = USER_PREFIX + it.id) }
        return all + agents + people
    }

    /** 光标前的 "@xx" 里的 xx; 没在输 @ 时为 null。 */
    fun query(beforeCursor: String): String? = QUERY.find(beforeCursor)?.groupValues?.get(1)

    fun filter(list: List<MentionTarget>, q: String): List<MentionTarget> =
        if (q.isEmpty()) list else list.filter { it.label.contains(q, ignoreCase = true) }

    /** 发送时: 选过且 "@名字" 还在正文里的才算。 */
    fun tokens(text: String, picked: List<MentionTarget>): List<String> =
        picked.filter { "@${it.label}" in text }.map { it.token }.distinct()

    /** 气泡里要高亮的名字, 长的先匹配。 */
    fun names(candidates: List<MentionTarget>): List<String> = (candidates.map { it.label } + ALL_LABEL).filter { it.isNotBlank() }.distinct().sortedByDescending { it.length }

    fun roleLabel(role: String?): String = when (role) {
        ROLE_OWNER -> "群主"
        ROLE_ADMIN -> "管理员"
        else -> com.hengxin.aioa.ui.ROLE_MEMBER_LABEL
    }

    const val USER_PREFIX = "user:"
}
