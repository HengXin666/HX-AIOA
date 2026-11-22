package com.hengxin.aioa.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.hengxin.aioa.AioaApp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.data.CrashLog
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.link.LinkSocket
import com.hengxin.aioa.link.NotifyKit
import com.hengxin.aioa.proto.Frames
import com.hengxin.aioa.kit.TaskOption
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.proto.TaskSnapshot
import com.hengxin.aioa.proto.toMsg
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

private const val CRASH_TITLE = "**上次崩溃**\n"
private const val FENCE = "```"

// 打开界面: 先从本地库秒出历史, 再用 since=本地最大序号 只补拉增量; 后台推送全部交给 :link 进程
class ChatModel(app: Application) : AndroidViewModel(app), LinkSocket.Listener {

    val device = AioaApp.deviceId(app, Constants.DEVICE_UI)
    val messages = mutableStateListOf<ServerFrame.Msg>()
    var online by mutableStateOf(false)
        private set

    // 本次打开时的已读位置, 用于画 "以下是新消息" 分隔线, 会话内保持不变
    var dividerSeq by mutableLongStateOf(Long.MAX_VALUE)
        private set
    var loaded by mutableStateOf(false)
        private set
    var configured by mutableStateOf(ConfigStore.load(app) != null)
        private set

    private val db = MessageDb.get(app)

    @Volatile
    private var lastSeq = 0L
    private val socket = LinkSocket(app, device, { lastSeq }, this, forLink = true)
    val metrics = MetricsState { socket.send(Frames.watch(it)) }
    val feed = FeedState(socket::send)
    val spaces = SpacesState(app, viewModelScope, metrics)
    val sources = SourcesState(app, viewModelScope)
    val github = GithubState(app, viewModelScope)
    val groups = ChatGroups(app, viewModelScope, db, socket::send).also { g -> g.directory.onMetas = { g.applyReads() } }

    fun resume() {
        NotifyKit.clearMessages(getApplication<Application>())
        viewModelScope.launch {
            val (history, readSeq) = withContext(Dispatchers.IO) { db.recent(Constants.HISTORY_PAGE) to db.readSeq() }
            merge(history)
            if (!loaded) {
                dividerSeq = readSeq
                loaded = true
            }
            markRead()
            groups.reload()
            if (configured) {
                groups.loadFolders()
                groups.directory.load()
                socket.start()
            }
        }
    }

    fun pause() {
        groups.flushRead()
        socket.stop()
        online = false
        // 下次打开时重新计算分隔线
        loaded = false
    }

    fun onConfigSaved() {
        configured = ConfigStore.load(getApplication<Application>()) != null
        socket.restart()
    }

    fun send(text: String): Boolean {
        val body = text.trim()
        if (body.isEmpty()) return false
        return socket.send(Frames.send(UUID.randomUUID().toString(), body))
    }

    fun answer(task: TaskSnapshot, option: TaskOption, confirm: Boolean = false) {
        val (kind, picked) = actionOf(option)
        feed.act(task.id, kind, picked, confirm)
    }

    fun isMine(msg: ServerFrame.Msg): Boolean = msg.src.startsWith(Constants.DEVICE_PREFIX)

    override fun onStatus(online: Boolean) {
        this.online = online
        if (online) metrics.onOnline()
        if (online) CrashLog.take(getApplication())?.let { send(CRASH_TITLE + FENCE + "\n" + it + "\n" + FENCE) }
    }

    override fun onFrame(frame: ServerFrame) {
        if (metrics.onFrame(frame) || spaces.onFrame(frame)) return
        if (frame is ServerFrame.ChatSync) return groups.directory.onSync(frame.topic)
        if (frame is ServerFrame.Settings) runCatching { org.json.JSONObject(frame.raw) }.getOrNull()?.let(groups::applySettings)
        if (frame is ServerFrame.Ev) {
            sources.onEvent(frame.ev.source.id, frame.ev.title)
            github.onEvent(frame.ev.source)
        }
        // v1 的事件同时进消息列表 (压成一行), 保持消息页与旧版一致
        if (frame is ServerFrame.Ev && frame.ev.kind != Constants.KIND_METRIC) accept(frame.ev.toMsg())
        if (feed.onFrame(frame) || frame !is ServerFrame.Msg) return
        accept(frame)
    }

    private fun accept(frame: ServerFrame.Msg) {
        socket.send(Frames.ack(frame.seq))
        merge(listOf(frame))
        viewModelScope.launch(Dispatchers.IO) {
            db.insert(frame)
            db.markRead(frame.seq)
            withContext(Dispatchers.Main) { groups.onMessage(frame) }
        }
    }

    // 按序号去重合并, 保持有序
    private fun merge(incoming: List<ServerFrame.Msg>) {
        val fresh = incoming.filter { it.seq > lastSeq }
        if (fresh.isEmpty()) return
        messages.addAll(fresh)
        lastSeq = fresh.last().seq
    }

    private fun markRead() {
        val seq = lastSeq
        viewModelScope.launch(Dispatchers.IO) { db.markRead(seq) }
    }

    override fun onCleared() {
        socket.stop()
    }
}
