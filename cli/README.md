# HostSync

主机感知的配置文件同步系统：**一键同步本机目录到 S3 兼容存储**，并按 **hostname/绝对路径** 自动分层；同时提供 **内置 Web UI** 用于查看各主机的配置文件树与预览下载。

## 特性

- **自动分层**：`bucket/<hostname>/<abs-path>/...`
- **跨平台路径标准化**：macOS/Linux `/Users/...`；Windows `C:\...` → `c/...`
- **忽略规则**：读取当前目录的 `.cfgignore`（语法同 `.gitignore`）
- **Web UI 安全**：仅绑定 `127.0.0.1` + 启动时生成 **5 分钟有效 Token**
- **对象存储**：对接 **S3 兼容 API** 的云对象存储（主流云厂商通常提供 S3 兼容网关/接口）

## 安装依赖 & 构建

在仓库根目录：

```bash
npm install
npm run build
```

## 初始化 CLI 配置

```bash
npm -w cli run build
node cli/dist/index.js init
```

你需要在任意云对象存储侧准备好：

- **Endpoint**：S3 兼容的访问地址（建议填写完整 URL，如 `https://s3.example.com` 或 `https://s3.example.com:9000`）
- **Bucket**：已创建的 bucket 名称
- **Access Key / Secret Key**：访问凭证（建议最小权限：仅允许对该 bucket 的读写/列举）
- **Region（可选）**：部分服务需要；不确定可先留空
- **path-style（推荐默认开启）**：多数 S3 兼容对象存储更兼容 `https://endpoint/bucket/key`；若你的服务要求 `https://bucket.endpoint/key`，将其关闭

配置会保存到：

- macOS/Linux：`~/.config/hostsync/config.json`
- Windows：`%APPDATA%/hostsync/config.json`（若无则回退到 home）

### 配置文件格式（`config.json`）

示例：

```json
{
  "endpoint": "https://s3.example.com:9000",
  "bucket": "my-config-bucket",
  "accessKey": "AKIAxxxxxxxx",
  "secretKey": "xxxxxxxxxxxxxxxx",
  "region": "us-east-1",
  "forcePathStyle": true
}
```

- **endpoint**：S3 兼容服务的地址。建议写成带协议的完整 URL（`https://...` 或 `http://...`）。
- **bucket**：存放配置的 bucket。
- **accessKey / secretKey**：凭证。
- **region**：可选；多数 S3 兼容服务会忽略，但也有服务会要求填写。
- **forcePathStyle**：可选；默认 `true`。当你的对象存储要求虚拟主机风格（`bucket.endpoint`）时设为 `false`。

## 日常使用

在任意项目目录：

```bash
hostsync push
hostsync pull

# 仅同步单个文件（相对当前目录）
hostsync push .env
hostsync pull .env

# 或使用显式参数
hostsync push --file "config/app.yaml"
hostsync pull --file "config/app.yaml"

# 从对象存储中按完整 key 拉取任意文件到当前目录
hostsync pull --key "<hostname>/Users/me/.claude/settings.json"

# 并指定保存路径（相对于当前目录）
hostsync pull --key "<hostname>/Users/me/.claude/settings.json" --as "claude/settings.json"
```

### 运行方式说明（当前仓库内）

由于目前还没发布到 npm/全局，你可以用以下方式运行：

- **构建后运行（推荐）**：

```bash
npm -w cli run build
node cli/dist/index.js push
node cli/dist/index.js pull
node cli/dist/index.js web --port 3000
```

- **开发运行**：

```bash
npm run dev:cli -- push
npm run dev:cli -- pull
npm run dev:cli -- web --port 3000
npm run dev:cli -- scan
npm run dev:cli -- scan --push --yes
```

远端对象结构示例：

```
s3://hostsync/<hostname>/<abs-path>/<relative-file>
```

### 远端路径映射规则（按主机名分层）

- **前缀**：`<hostname>/<abs-path>`
  - hostname 会做小写与字符归一化（仅保留 `[a-z0-9-]`）
  - abs-path 会跨平台标准化（Windows `C:\...` → `c/...`）
  - 路径分段会做 URL 编码，避免空格等字符导致兼容性问题
- **对象 key**：`<prefix>/<relative-file>`

示例（macOS）：

```
bucket/
  macbook-pro/Users/luyuchao/projects/app/.env
```

示例（Windows）：

```
bucket/
  win-pc/c/Users/Alice/app/config.yaml
```

### push / pull 的行为细节

- **push**
  - 遍历当前目录（跳过符号链接），读取 `.cfgignore` 过滤
  - 上传到对应远端前缀下（同名 key 会被覆盖）
  - 不会删除远端多余文件
- **push（单文件）**
  - `hostsync push <file>` 或 `hostsync push --file <file>`
  - 仅允许同步当前目录内的普通文件（拒绝符号链接）
- **pull**
  - 列举远端前缀下所有对象并下载
  - 同样会应用 `.cfgignore`（被忽略的不会写入本地）
  - 不会删除本地多余文件
- **pull（单文件）**
  - `hostsync pull <file>` 或 `hostsync pull --file <file>`
  - 仅会把该文件下载并写回当前目录内对应路径（仍会应用 `.cfgignore`）

### 忽略规则（`.cfgignore`）

在要同步的目录下放置 `.cfgignore`，语法与 `.gitignore` 相同。项目根目录自带了一个示例 `.cfgignore`，你可以按需复制/扩展。

### 建议的最小权限（参考 AWS IAM 命名）

不同云的权限系统不完全一致，但通常需要这三类能力：

- **List**：列举 bucket 内指定前缀
- **Get**：下载对象
- **Put**：上传对象

如果你使用 AWS/IAM 风格策略，可参考（按需替换 bucket）：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": ["arn:aws:s3:::my-config-bucket"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject"],
      "Resource": ["arn:aws:s3:::my-config-bucket/*"]
    }
  ]
}
```

## 启动 Web UI

```bash
hostsync web --port 3000
```

终端会输出：

- 访问地址：`http://127.0.0.1:3000`
- 临时 Token（5 分钟有效）

浏览器打开后输入 Token，即可：

- 查看主机列表
- 浏览文件树
- 预览文本文件（YAML/JSON 等）
- 下载文件

## 开发模式

Web UI 开发：

```bash
npm run dev:web
```

CLI 开发：

```bash
npm run dev:cli
```

## 常见问题（排错）

- **报 403 / SignatureDoesNotMatch**
  - 检查 accessKey/secretKey 是否正确
  - 尝试填写/调整 `region`
  - 某些服务需要关闭 `forcePathStyle`（改成虚拟主机风格）
- **报 DNS/证书错误**
  - 确认 endpoint 是否能在本机访问
  - endpoint 建议使用 `https://`；若是内网网关可用 `http://`
- **Web UI 打开后看不到数据**
  - Token 是否已过期（5 分钟）
  - Web 服务是否仍在运行（绑定 `127.0.0.1`）
