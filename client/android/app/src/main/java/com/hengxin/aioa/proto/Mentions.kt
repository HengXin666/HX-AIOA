package com.hengxin.aioa.proto

/** @ 提醒 (#131) 的记号: 真人写 uid, Agent 写 agent:<keyId>, 全体写 all。纯数据, :link 进程也用。 */
object Mentions {
    const val ALL = "all"
    const val AGENT_PREFIX = "agent:"

    fun agent(keyId: String) = AGENT_PREFIX + keyId

    fun hits(mentions: List<String>, uid: String?): Boolean = ALL in mentions || (uid != null && uid in mentions)
}
