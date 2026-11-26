package com.hengxin.aioa.net

import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlin.test.Test
import kotlin.test.assertEquals

class ErrKindTest {
    @Test
    fun byCode() {
        assertEquals(ErrKind.AUTH, ErrKind.of(401))
        assertEquals(ErrKind.DENIED, ErrKind.of(403))
        assertEquals(ErrKind.INPUT, ErrKind.of(400))
        assertEquals(ErrKind.TIMEOUT, ErrKind.of(524))
        assertEquals(ErrKind.SERVER, ErrKind.of(500))
    }

    @Test
    fun describedTextGuessesBack() {
        assertEquals(ErrKind.TIMEOUT, ErrKind.guess(ErrKind.describe(SocketTimeoutException("timeout"))))
        assertEquals(ErrKind.NETWORK, ErrKind.guess(ErrKind.describe(UnknownHostException("x"))))
        assertEquals(ErrKind.DENIED, ErrKind.guess("只有主人能改"))
        assertEquals(ErrKind.OTHER, ErrKind.guess("群名称太长"))
    }
}
