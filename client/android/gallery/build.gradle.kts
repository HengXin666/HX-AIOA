// 桌面组件画廊: ./gradlew :gallery:hotRunDesktop -PdesktopOnly=true (热重载) 或 :gallery:run
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.compose.hot.reload)
}

kotlin { jvmToolchain(17) }

dependencies {
    implementation(project(":ui"))
    implementation(compose.desktop.currentOs)
    implementation(libs.kotlinx.coroutines.swing)
    implementation(libs.org.json)
}

compose.desktop {
    application {
        mainClass = "com.hengxin.aioa.gallery.MainKt"
    }
}

// 无界面截图: ./gradlew :gallery:screenshots -PdesktopOnly=true, 输出在 gallery/build/screenshots
tasks.register<JavaExec>("screenshots") {
    group = "verification"
    classpath = sourceSets["main"].runtimeClasspath
    mainClass.set("com.hengxin.aioa.gallery.ShotKt")
    args(layout.buildDirectory.dir("screenshots").get().asFile.path)
    systemProperty("java.awt.headless", "true")
    maxHeapSize = "768m"
}
