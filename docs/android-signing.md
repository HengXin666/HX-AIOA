# 安卓签名与自动发布

推送到 `main` 且改动了 `client/android/` 时, GitHub Actions 会编译签名后的 APK, 并发布到 Releases (标签 `android-<编号>`)。也可以在 Actions 页手动运行 "安卓构建"。

## 一次性配置

在仓库 Settings → Secrets and variables → Actions → New repository secret 添加:

| 名称 | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 签名密钥 (PKCS12) 的 base64 |
| `ANDROID_KEYSTORE_PASSWORD` | 密钥密码 |

可选: `ANDROID_KEY_ALIAS`, 默认 `aioa`。

## 注意

- 密钥务必另外备份。丢了就无法覆盖安装, 只能卸载重装。
- 仓库是公开的, 所以 APK 里不包含服务端地址和令牌, 首次打开 app 时在界面里填写。
- 版本号取 `GITHUB_RUN_NUMBER`, 每次构建递增, 可以直接覆盖安装。
- 本地构建没有这些环境变量时, release 包退回 debug 签名。
