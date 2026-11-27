package com.hengxin.aioa.ui

import com.hengxin.aioa.data.groupKey

import com.hengxin.aioa.net.ApiCache
import com.hengxin.aioa.proto.V1Decode
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
import com.hengxin.aioa.data.Me
import com.hengxin.aioa.data.MessageDb
import com.hengxin.aioa.data.replacedBy
import com.hengxin.aioa.link.LinkSocket
import com.hengxin.aioa.link.NotifyKit
import com.hengxin.aioa.proto.Frames
import com.hengxin.aioa.ui.term.TermHub
import com.hengxin.aioa.ui.settings.PluginEvents
import com.hengxin.aioa.kit.TaskOption
import com.hengxin.aioa.proto.ServerFrame
import com.hengxin.aioa.proto.TaskSnapshot
import com.hengxin.aioa.proto.toMsg
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import com.hengxin.aioa.data.MutedGroups
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay

private const val CRASH_TITLE = "**上次崩溃**\n"
private const val FENCE = "```"
private const val CACHE_OVERVIEW = "overview"

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
    private val socket = LinkSocket(app, device, { lastSeq }, this, forLink = true, ui = true)
    val metrics = MetricsState { socket.send(Frames.watch(it)) }
    val terms = TermHub(socket::send)
    val feed = FeedState(socket::send) { raw ->
        viewModelScope.launch(Dispatchers.IO) { runCatching { ApiCache.write(app, CACHE_OVERVIEW, org.json.JSONObject(raw)) } }
    }
    val spaces = SpacesState(app, viewModelScope, metrics)
    val seen = SeenStore(app)
    // 先拉一次来源列表: 聊天里按来源 id 显示最新名字要用
    val sources = SourcesState(app, viewModelScope).also { it.refresh() }
    val github = GithubState(app, viewModelScope)
    val groups = ChatGroups(app, viewModelScope, db, socket::send).also { g ->
        g.directory.onMetas = { g.applyReads() }
        g.onSettings = { s ->
            spaces.tabs.apply(s)
            // 旧版头像只存在设置里 (#142): 账号上没头像时侧栏用它兜底
            Me.setSettingsAvatar(getApplication(), s.optString("avatar").ifEmpty { null })
        }
        g.onCleared = { key, upTo -> messages.removeAll { it.seq <= upTo && it.groupKey() == key } }
    }

    fun resume() {
        stopJob?.cancel()
        visible = true
        NotifyKit.clearMessages(getApplication<Application>())
        viewModelScope.launch {
            val (history, readSeq) = withContext(Dispatchers.IO) { db.recent(Constants.HISTORY_PAGE) to db.readSeq() }
            merge(history)
            if (!feed.loaded) {
                withContext(Dispatchers.IO) { ApiCache.read(getApplication(), CACHE_OVERVIEW)?.let { runCatching { V1Decode.overview(it) }.getOrNull() } }?.let(feed::restore)
            }
            if (!loaded) {
                dividerSeq = readSeq
                loaded = true
            }
            markRead()
            groups.reload()
            groups.refreshOpen()
            if (configured) {
                groups.loadFolders()
                groups.directory.load()
                socket.start()
            }
        }
    }

    // 切走后连接多留一会儿: 短时间切回来不必重新建连, 也不会闪 "连接中"
    private var stopJob: Job? = null
    // 界面不可见时 (保留连接期间) 收到的消息只入库, 不算已读, 不弹横幅
    @Volatile
    private var visible = false

    fun pause() {
        visible = false
        groups.flushRead()
        stopJob?.cancel()
        stopJob = viewModelScope.launch {
            delay(Constants.UI_LINGER_MS)
            socket.stop()
            online = false
        }
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

    fun isMine(msg: ServerFrame.Msg): Boolean = msg.mine

    override fun onStatus(online: Boolean) {
        this.online = online
        if (online) metrics.onOnline() else terms.onOffline()
        if (online) github.probeIfOff()
        if (online) groups.refreshOpen()
        if (online) CrashLog.take(getApplication())?.let { send(CRASH_TITLE + FENCE + "\n" + it + "\n" + FENCE) }
    }

    override fun onFrame(frame: ServerFrame) {
        if (metrics.onFrame(frame) || spaces.onFrame(frame) || terms.onFrame(frame)) return
        if (frame is ServerFrame.ChatSync) return groups.directory.onSync(frame.topic, frame.chat)
        if (frame is ServerFrame.ChatRead) return groups.directory.applyRead(frame.channel, frame.read)
        if (frame is ServerFrame.AgentActive) return groups.directory.setAgentActive(frame.channel, frame.keyId, frame.active)
        if (frame is ServerFrame.Presence) return groups.presence.apply(frame)
        if (frame is ServerFrame.Online) return com.hengxin.aioa.ui.chat.PeopleOnline.apply(frame)
        if (frame is ServerFrame.PluginUpdate) {
            PluginEvents.bump()
            spaces.onPlugin(frame.id, frame.change)
            return if (frame.id == Constants.GITHUB_PLUGIN) github.onPlugin(frame.change) else Unit
        }
        if (frame is ServerFrame.Welcome) Me.set(getApplication(), frame.uid, frame.name)
        // 侧栏账号头的头像跟账号走 (#142): welcome 带了账号就以它为准 (没头像即清掉)
        if (frame is ServerFrame.Welcome && frame.hasUser) Me.setAvatar(getApplication(), frame.avatar)
        if (frame is ServerFrame.Welcome) PluginEvents.setCompat(frame.compat)
        if (frame is ServerFrame.Welcome && frame.resync && frame.floor > 0) groups.dropBefore(frame.floor)
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

    /** 应用在前台时别的群来的新消息, 顶部横幅显示几秒; 正在看的群, 自己发的, 免打扰的, 补拉的旧消息不弹。 */
    var banner by mutableStateOf<ServerFrame.Msg?>(null)
    private var bannerJob: Job? = null

    private fun maybeBanner(frame: ServerFrame.Msg) {
        val key = frame.groupKey()
        if (isMine(frame) || groups.open == key || System.currentTimeMillis() - frame.ts > BANNER_FRESH_MS) return
        if (MutedGroups.contains(getApplication(), key) && !com.hengxin.aioa.proto.Mentions.hits(frame.mentions, Me.uid)) return
        banner = frame
        bannerJob?.cancel()
        bannerJob = viewModelScope.launch {
            delay(BANNER_SHOW_MS)
            banner = null
        }
    }

    fun openBanner() {
        val msg = banner ?: return
        banner = null
        groups.openGroup(msg.groupKey())
    }

    private fun accept(frame: ServerFrame.Msg) {
        if (visible && frame.seq > lastSeq && frame.deleted == null) maybeBanner(frame)
        socket.send(Frames.ack(frame.seq))
        merge(listOf(frame))
        viewModelScope.launch(Dispatchers.IO) {
            db.insert(frame)
            if (visible) db.markRead(frame.seq)
            withContext(Dispatchers.Main) { groups.onMessage(frame, visible) }
        }
    }

    // 按序号去重合并, 保持有序; 同 id 的新版本 (更新, 撤回) 替换旧的, 删除墓碑只删不加
    private fun merge(incoming: List<ServerFrame.Msg>) {
        val fresh = incoming.filter { it.seq > lastSeq }
        if (fresh.isEmpty()) return
        fresh.forEach { m -> messages.removeAll { it.replacedBy(m) } }
        messages.addAll(fresh.filter { it.deleted != MessageDb.DELETE_MODE })
        lastSeq = fresh.last().seq
    }

    private fun markRead() {
        val seq = lastSeq
        viewModelScope.launch(Dispatchers.IO) { db.markRead(seq) }
    }

    override fun onCleared() {
        socket.stop()
    }

    private companion object {
        const val BANNER_SHOW_MS = 4000L
        const val BANNER_FRESH_MS = 60_000L
    }
}
