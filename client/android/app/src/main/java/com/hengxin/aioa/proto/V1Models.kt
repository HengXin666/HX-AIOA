package com.hengxin.aioa.proto

// 协议 v1 的客户端视图, 只保留界面与通知用得到的字段; 对应 protocol/src/v1/{event,task,frames}.ts

data class SourceRef(val id: String, val name: String, val icon: String?, val type: String? = null)

data class EventAction(val id: String, val label: String, val style: String?, val url: String?)

data class PromptOption(val id: String, val label: String, val style: String?)

data class Prompt(
    val id: String,
    val question: String,
    val options: List<PromptOption>,
    val allowText: Boolean,
    val danger: Boolean,
    val expires: Long?,
    val expired: Boolean,
)

data class TaskSnapshot(
    val id: String,
    val agent: String,
    val title: String,
    val summary: String?,
    val subject: String?,
    val state: String,
    val progress: Double?,
    val step: String?,
    val prompt: Prompt?,
    val result: String?,
    val error: String?,
    val created: Long,
    val updated: Long,
)

/** 统一事件信封。data 按 kind 拆开: event/report 用 title 等, metric 用 values, task 用 task。 */
data class Envelope(
    val id: String,
    val seq: Long,
    val ts: Long,
    val kind: String,
    val source: SourceRef,
    val subject: String?,
    val channel: String?,
    val priority: String,
    val groupKey: String?,
    val actions: List<EventAction>,
    val resolved: Boolean,
    val route: String?,
    val title: String,
    val summary: String?,
    val severity: String?,
    val status: String?,
    val url: String?,
    val values: Map<String, Double>,
    val task: TaskSnapshot?,
    val dedupeKey: String? = null,
    val markdown: String? = null,
    val html: String? = null,
    val cid: String? = null,
    val reply: MsgRef? = null,
    val fwd: FwdInfo? = null,
    // 墓碑: recall / delete, 以及被替换那条的旧序号
    val deleted: String? = null,
    val deletedSeq: Long = 0,
    // 发送者账号 id (人发的聊天消息)
    val by: String? = null,
    val file: FileRef? = null,
)

/** 消息附件: 字节在服务端 R2, 消息里只有引用。 */
data class FileRef(val id: String, val name: String, val size: Long, val mime: String) {
    val image get() = mime.startsWith("image/")

    fun toJson(): org.json.JSONObject = org.json.JSONObject().put("id", id).put("name", name).put("size", size).put("mime", mime)

    companion object {
        fun parse(o: org.json.JSONObject?): FileRef? {
            val id = o?.optString("id")?.ifEmpty { null } ?: return null
            return FileRef(id, o.optString("name").ifEmpty { id }, o.optLong("size"), o.optString("mime").ifEmpty { "application/octet-stream" })
        }
    }
}

/** 引用的快照: 原消息的序号, 来源与摘要。 */
data class MsgRef(val seq: Long, val src: String, val text: String)

/** 转发: 原消息的来源与时间。 */
data class FwdInfo(val src: String, val ts: Long)

data class OverviewItem(val ev: Envelope, val count: Int, val ids: List<String>)

data class Overview(val layers: Map<String, List<OverviewItem>>, val tasks: List<TaskSnapshot>, val generatedAt: Long)

data class AgentStatus(val id: String, val name: String, val online: Boolean, val lastSeen: Long)
