import org.jetbrains.kotlin.gradle.dsl.JvmTarget

// 共享组件库: 安卓 App 和桌面画廊用同一份代码, 电脑上看到的就是手机上的样子
val desktopOnly = providers.gradleProperty("desktopOnly").orNull == "true"

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.compose.multiplatform)
    alias(libs.plugins.android.library) apply false
}

if (!desktopOnly) apply(plugin = "com.android.library")

kotlin {
    jvmToolchain(17)
    jvm("desktop")
    if (!desktopOnly) {
        androidTarget { compilerOptions { jvmTarget.set(JvmTarget.JVM_17) } }
    }
    sourceSets {
        commonMain.dependencies {
            implementation(compose.runtime)
            implementation(compose.foundation)
            implementation(compose.ui)
        }
    }
}

if (!desktopOnly) {
    extensions.configure<com.android.build.api.dsl.LibraryExtension>("android") {
        namespace = "com.hengxin.aioa.kit"
        compileSdk = 36
        defaultConfig { minSdk = 26 }
        compileOptions {
            sourceCompatibility = JavaVersion.VERSION_17
            targetCompatibility = JavaVersion.VERSION_17
        }
    }
}
