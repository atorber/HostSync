# HostSync 桌面端

Tauri 2 + React 桌面应用，功能与 CLI + Web UI 一致：使用本地 `~/.config/hostsync/config.json`（与 CLI 共用），浏览 S3 主机与文件、预览文本、下载、复制 CLI 命令。

## 环境要求

- **Rust**：桌面端通过 `src-tauri/rust-toolchain.toml` 指定使用 **1.91**。首次在 `desktop` 下执行 `npm run tauri dev` 或 `cargo` 时，若本机不是 1.91，rustup 会提示安装，执行 `rustup show` 确认当前 channel 或运行一次 `cargo check` 触发安装即可。
- **Node** 18+
- 已用 CLI 配置好 S3（`hostsync init`），配置文件位于 `~/.config/hostsync/config.json`（Windows：`%APPDATA%\hostsync\config.json`）

## 开发

```bash
# 在仓库根目录
npm run dev:desktop
```

## 打包

```bash
npm run build:desktop
```

产出在 `desktop/src-tauri/target/release/bundle/`。
