pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "HX-AIOA"

// -PdesktopOnly=true 时只构建组件库的桌面目标和画廊, 电脑上不需要安卓 SDK
val desktopOnly = providers.gradleProperty("desktopOnly").orNull == "true"
include(":ui", ":gallery")
if (!desktopOnly) include(":app")
