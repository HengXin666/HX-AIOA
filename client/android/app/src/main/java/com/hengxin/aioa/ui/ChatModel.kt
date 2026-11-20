package com.hengxin.aioa.ui

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import com.hengxin.aioa.AioaApp
import com.hengxin.aioa.Constants
import com.hengxin.aioa.config.AppConfig
import com.hengxin.aioa.config.ConfigStore
import com.hengxin.aioa.link.LinkService
import com.hengxin.aioa.link.LinkSocket
import com.hengxin.aioa.proto.Frames
import com.hengxin.aioa.proto.ServerFrame
import java.util.UUID

// 界面进程只在前台时持有自己的连接, 退到后台立即断开, 后台推送全部交给 :link 进程
class ChatModel(app: Application) : AndroidViewModel(app), LinkSocket.Listener {

    val device = AioaApp.deviceId(app, Constants.DEVICE_UI)
    val messages = mutableStateListOf<ServerFrame.Msg>()
    var online by mutableStateOf(false)
        private set

    private var lastSeq = 0L
    private val socket = LinkSocket(app, device, { lastSeq }, this)

    var configured by mutableStateOf(ConfigStore.load(app) != null)
        private set

    fun resume() {
        if (configured) socket.start()
    }

    fun saveConfig(server: String, token: String): Boolean {
        val config = AppConfig(server.trim(), token.trim())
        if (!config.valid) return false
        val app = getApplication<Application>()
        ConfigStore.save(app, config)
        configured = true
        LinkService.start(app)
        socket.start()
        return true
    }

    fun pause() {
        socket.stop()
        online = false
    }

    fun send(text: String): Boolean {
        val body = text.trim()
        if (body.isEmpty()) return false
        return socket.send(Frames.send(UUID.randomUUID().toString(), body))
    }

    override fun onStatus(online: Boolean) {
        this.online = online
    }

    override fun onFrame(frame: ServerFrame) {
        if (frame !is ServerFrame.Msg || frame.seq <= lastSeq) return
        lastSeq = frame.seq
        messages.add(frame)
        socket.send(Frames.ack(frame.seq))
    }

    override fun onCleared() {
        socket.stop()
    }
}
