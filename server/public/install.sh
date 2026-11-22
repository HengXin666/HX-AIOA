#!/bin/sh
# HX-AIOA 探针一行安装 (命令由 App "资源 → 添加主机" 生成):
#   curl -fsSL -A hx-aioa-agent/1 <服务端>/install.sh | sh -s -- --server <服务端> --key <key> --name <名字> [--shell]
# 卸载: 同一条命令把参数换成 --uninstall
set -eu
UA="hx-aioa-agent/1"
UNIT="hx-aioa-probe"
SERVER=""
KEY=""
NAME=""
SHELL_ON=0
UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --server) SERVER=$2; shift 2 ;;
    --key) KEY=$2; shift 2 ;;
    --name) NAME=$2; shift 2 ;;
    --shell) SHELL_ON=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "未知参数: $1" >&2; exit 1 ;;
  esac
done

if [ "$(id -u)" = 0 ]; then
  DIR=/opt/$UNIT
  UNIT_DIR=/etc/systemd/system
  SC="systemctl"
  TARGET=multi-user.target
else
  DIR=${XDG_DATA_HOME:-$HOME/.local/share}/$UNIT
  UNIT_DIR=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
  SC="systemctl --user"
  TARGET=default.target
fi

if [ "$UNINSTALL" = 1 ]; then
  $SC disable --now "$UNIT" 2>/dev/null || true
  rm -f "$UNIT_DIR/$UNIT.service"
  rm -rf "$DIR"
  echo "已卸载。记得在 App 里删掉这台主机的 key。"
  exit 0
fi

case "$SERVER" in https://*) ;; *) echo "--server 必须是 https 地址" >&2; exit 1 ;; esac
[ -n "$KEY" ] && [ -n "$NAME" ] || { echo "需要 --key 和 --name" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "需要 Node.js 22 或更新版本" >&2; exit 1; }
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || { echo "Node 版本太旧, 需要 22+" >&2; exit 1; }
if [ "$SHELL_ON" = 1 ]; then
  command -v python3 >/dev/null 2>&1 || { echo "终端需要 python3" >&2; exit 1; }
  [ "$(id -u)" = 0 ] && echo "注意: 以 root 安装, 终端会话也是 root 权限。更安全的做法是用普通用户安装。"
fi

mkdir -p "$DIR" "$UNIT_DIR"
for f in probe.mjs probe-term.mjs; do
  curl -fsSL -A "$UA" "$SERVER/$f" -o "$DIR/$f.new"
  mv "$DIR/$f.new" "$DIR/$f"
done
# 配置里有 key, 只给自己读
umask 077
cat > "$DIR/env" <<CONF
AIOA_SERVER=$SERVER
AIOA_TOKEN=$KEY
AIOA_SUBJECT=$NAME
AIOA_SHELL=$SHELL_ON
CONF
chmod 600 "$DIR/env"

NODE=$(command -v node)
# 从非登录 shell (ssh 命令, 远程执行) 安装时补上用户会话的环境, 否则会误判成没有 systemd
if [ "$(id -u)" != 0 ] && [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then
  export XDG_RUNTIME_DIR="/run/user/$(id -u)"
fi
if command -v systemctl >/dev/null 2>&1 && $SC show-environment >/dev/null 2>&1; then
  cat > "$UNIT_DIR/$UNIT.service" <<SVC
[Unit]
Description=HX-AIOA 探针 ($NAME)
After=network-online.target
Wants=network-online.target

[Service]
EnvironmentFile=$DIR/env
ExecStart=$NODE $DIR/probe.mjs
WorkingDirectory=$DIR
Restart=always
RestartSec=5

[Install]
WantedBy=$TARGET
SVC
  $SC daemon-reload
  $SC enable --now "$UNIT"
  $SC restart "$UNIT"
  echo "已安装并启动: $UNIT ($SC status $UNIT 查看)"
  [ "$(id -u)" != 0 ] && echo "普通用户安装: 执行 loginctl enable-linger $(id -un) 让探针在退出登录后继续运行。"
else
  # 没有 systemd: 后台运行, 重启后需要再执行一次
  set -a; . "$DIR/env"; set +a
  nohup "$NODE" "$DIR/probe.mjs" >"$DIR/probe.log" 2>&1 &
  echo "没有 systemd, 已在后台运行 (日志 $DIR/probe.log), 开机自启请自行配置。"
fi
exit 0
