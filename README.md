# edu-workspace

教材/教辅 PDF 后台动态扫描导入、REST API 管理、前端 React + Zustand 可视化阅读、Canvas 批注与错题裁剪归类系统。

## 架构

Monorepo 单仓多目录：
- `/server` — Node.js + Express + Prisma 后端服务
- `/client` — React + Vite + Zustand 前端应用 (PC & Pad)

## 快速开始

```bash
# 安装所有依赖
npm install

# 数据库迁移
cd server && npx prisma db push && cd ..

# 同时启动前后端开发服务
npm run dev
```

开发后端运行在 http://localhost:4001，开发前端运行在 http://localhost:5174。生产局域网服务使用 `4000/5173`。

开发环境不会占用生产端口：

```text
开发前端：5174 → 开发后端：4001
生产前端：5173 → 生产后端：4000
```

因此开发时不需要停止局域网部署服务。

## 配置资源目录

书籍页面、原始 PDF、DPI 图片和错题裁剪图片统一存放在资源根目录。当前目录可在后台“资源目录设置”中修改，修改后立即生效，不需要重启服务。

推荐目录结构：

```text
/Users/{user}/Downloads/storage/
├── books/{bookId}/
│   ├── original.pdf
│   └── {dpi}/page-0001.png
└── crops/{bookId}/
```

浏览器访问的是 `/storage/...`，不直接访问本机绝对路径。

## 生产构建

代码更新后重新构建前后端：

```bash
cd /Users/{user}/工作/github/edu-workspace
npm run build
```

生产启动命令：

```bash
npm run start:prod
```

## macOS 局域网部署

项目使用 Caddy 提供前端静态文件和反向代理，使用 macOS `launchd` 守护后端与 Caddy。首次安装 Caddy：

```bash
brew install caddy
```

首次注册并启动服务：

```bash
cd /Users/{user}/工作/github/edu-workspace
npm run build
./scripts/install-lan-service.sh
```

安装脚本会注册以下服务，并设置为登录后自动启动、异常后自动拉起：

```text
com.edu-workspace.server
com.edu-workspace.caddy
```

当前局域网访问地址可以用以下命令查看：

```bash
ipconfig getifaddr en0 || ipconfig getifaddr en1
```

假设输出为 `192.168.1.6`，其他设备访问：

```text
http://192.168.1.6:5173
```

要求 Mac 与设备在同一局域网，并允许 macOS 防火墙接收对应端口连接。

### 日常服务命令

```bash
# 查看服务状态
./scripts/status-lan-service.sh

# 启动或重启服务
./scripts/start-lan-service.sh

# 停止服务
./scripts/stop-lan-service.sh

# 查看后端日志
./scripts/logs-lan-service.sh server

# 查看 Caddy 日志
./scripts/logs-lan-service.sh caddy
```

代码更新后的日常流程：

```bash
npm run build
./scripts/start-lan-service.sh
```

通常不需要重复执行安装脚本；只有修改了 `deploy/*.plist` 或首次配置服务时才需要执行 `install-lan-service.sh`。

## 数据清空与重新导入

后台“书籍资产管理”中的“一键清空”是不可逆操作，会：

- 删除数据库中的所有书籍及其级联批注、错题数据
- 删除资源目录下的 `books` 和 `crops` 子目录
- 保留资源根目录本身
- 重置 `Book` 表自增值，下一本书从 ID `1` 开始
- 通过实时进度条显示清理进度

清空后重新导入时，`books/{bookId}` 会自动重建。

## 原始 PDF 补全

导入逻辑优先使用 PDF 的 SHA-256 hash 判重：相同 hash 只保留一条书籍记录，其他来源路径追加到该书的 `sourcePaths`，不会重复切图。

如需从源目录补全原始 PDF，可使用：

```bash
cd /Users/{user}/工作/github/edu-workspace/server
COPY_CONCURRENCY=8 node scripts/backfill-source-pdfs.js
```

脚本按数据库 hash 匹配，并将 PDF 复制到 `storage/books/{bookId}/`。已存在相同内容的 PDF 会跳过。只预览、不复制：

```bash
DRY_RUN=1 COPY_CONCURRENCY=8 node scripts/backfill-source-pdfs.js
```

自定义源目录：

```bash
BOOK_SOURCE_ROOT="/path/to/pdf-root" COPY_CONCURRENCY=8 node scripts/backfill-source-pdfs.js
```

## 安全与备份

- 不要把 Caddy 端口映射到公网
- 不要对公网开放数据库端口
- 清空数据库或删除书籍前先备份数据库和资源目录
- 资源目录设置、PDF 扫描导入和“一键清空”都应只对可信局域网开放

## 核心功能

- **PDF 扫描导入**：输入本地绝对路径，自动扫描 PDF、解析大纲、切图存储、写入数据库，SSE 实时返回日志
- **书籍管理**：REST API 管理书籍、目录、页面图片
- **阅读批注**：左侧目录树导航、中间高清图、Canvas 批注（笔记/高亮/错题裁剪）
- **错题本**：裁剪错题入库、按学科/标签分类、复习状态管理
