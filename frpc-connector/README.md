# websdr.bd8ftc.de FRP穿透服务

插件 ID：`bd8ftc-frpc-connector`

## 定位

本插件用于接入 websdr.bd8ftc.de FRP穿透服务。插件会根据你的 websdr.bd8ftc.de 登记呼号下载专属 `frpc.toml`，然后启动本机 `frpc` 客户端。

它不是通用 FRP 管理器，也不在本机启动 `frps` 服务端；`frps` 由 websdr.bd8ftc.de 服务端维护。

## 支持平台

插件内置官方 fatedier/frp v0.68.1 的 `frpc` 客户端：

| 系统 | 架构 | 二进制 |
| --- | --- | --- |
| Windows | amd64 | `bin/windows-amd64/frpc.exe` |
| macOS | amd64 | `bin/darwin-amd64/frpc` |
| macOS | arm64 | `bin/darwin-arm64/frpc` |
| Linux | amd64 | `bin/linux-amd64/frpc` |
| Linux | arm64 | `bin/linux-arm64/frpc` |

## 功能

- 按登记呼号自动下载 websdr.bd8ftc.de 下发的 frpc 配置
- 自动选择当前平台对应的 frpc 客户端
- Windows 生成 `run-frpc.bat` 后运行
- macOS/Linux 生成 `run-frpc.sh`、设置执行权限后后台运行
- 支持异常退出后自动重启

## 使用

1. 先向 `bd8ftc@bd8ftc.de` 发送邮件申请开通，邮件中包含你的呼号。
2. 审核通过后，在插件设置中填写 websdr.bd8ftc.de 登记呼号。
3. 保持“保存配置后自动启动/重启”开启，保存后插件会自动下载配置并启动 frpc。
4. 如需手动控制，使用“启动/重启”和“停止”按钮。
5. 确认系统安全软件允许 `frpc` 或 `frpc.exe` 运行。
6. FRPC 启动后，访问 `websdr.bd8ftc.de`，并输入你的呼号来访问服务。

### 交互规则

- 未填写登记呼号时，插件只保存设置，不会启动 frpc，也不会反复报错。
- 如果呼号尚未开通，下载配置会返回 404；请按提示发邮件到 `bd8ftc@bd8ftc.de` 申请。
- “保存配置后自动启动/重启”开启时，保存呼号或重启间隔会立即启动或重启 frpc。
- 点击“启动/重启”会立即下载最新配置、重建脚本、停止旧进程并启动新进程。
- 点击“停止”会停止插件管理的 frpc，并保持停止状态；下次保存配置且自动启动开启时会再次启动。

成功运行后访问，并输入呼号：

👉 http://websdr.bd8ftc.de

## 日志和排错

- 运行配置：`frpc.toml`
- 进程记录：`frpc.pid`
- Windows 启动脚本：`run-frpc.bat`
- macOS/Linux 启动脚本：`run-frpc.sh`
- macOS/Linux 输出日志：`frpc.log`

如果 macOS/Linux 无法启动，请检查插件目录权限，或手动执行：

```sh
chmod +x run-frpc.sh bin/*/frpc
./run-frpc.sh
```

⚠ `frpc` 可能被 Windows 安全中心、macOS Gatekeeper 或杀毒软件拦截。如果无法启动，请将插件目录和对应二进制加入信任列表。
