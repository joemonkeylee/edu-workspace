# PDF 远端资源存储

PDF 原生模块和数据库备份支持本地和 HTTP 文件服务两种模式。默认 `PDF_STORAGE_MODE=local`，保留 `localhost + 本地 storage` 开发方式。切换为 HTTP 时，PDF 资源与数据库备份都写入远端文件服务；旧图片书籍 `Book` 路径不由此配置迁移。

## 本地开发

在 `server/.env` 中保留：

```dotenv
STORAGE_DIR=./storage
PDF_STORAGE_MODE=local
```

应用直接在 `STORAGE_DIR/pdf/` 读写 PDF 原件、封面、缩略图和错题裁图；数据库备份保存在 `STORAGE_DIR/db-backups/`。不需要启动文件服务。

## 同机部署（例如应用与资源服务都在 182）

在文件服务进程环境中设置资源根目录、监听地址和长随机令牌：

```dotenv
STORAGE_DIR=D:\edu-workspace-storage
FILE_SERVICE_HOST=127.0.0.1
FILE_SERVICE_PORT=4010
FILE_SERVICE_TOKEN=<至少 32 个随机字符>
```

Linux 路径示例：

```dotenv
STORAGE_DIR=/srv/edu-workspace-storage
```

构建后启动文件服务：

```sh
npm run build:server
npm run start:storage --workspace=server
```

在应用进程环境中配置同一令牌：

```dotenv
PDF_STORAGE_MODE=http
PDF_STORAGE_API_URL=http://127.0.0.1:4010
PDF_STORAGE_TOKEN=<与 FILE_SERVICE_TOKEN 相同>
```

在 PDF 管理页执行存储检查和初始化。该文件服务同时为数据库备份创建 `db-backups/` 目录。应用代理 PDF 读取请求并支持 Range；远端 PDF 原件不会经由普通业务接口整本下载后再返回。备份功能也使用远端存储，应用主机仍须安装并配置 MySQL `mysqldump` / `mysql` 命令，备份会在应用主机临时生成后上传。

## 文件服务位于另一台主机

文件服务可监听内网地址，但不要把 Node 文件服务端口直接暴露到公网。通过 HTTPS 反向代理访问，并在防火墙上限制来源为应用主机。应用端将 `PDF_STORAGE_API_URL` 设置为 HTTPS 地址，仍使用服务端令牌认证。文件服务本身不终止 TLS。

## 初始化空的正式库和同步

只有在目标数据库已确认是专用空库、文件服务地址和令牌已核对后才执行：

先将 `PRODUCTION_DATABASE_URL`、`FILE_SERVICE_URL`、`FILE_SERVICE_TOKEN` 配入 `server/.env`，再执行：

```sh
npm run db:init:production --workspace=server -- --confirm-empty
```

正式库须先按相同 ID 建立需保留的用户账号。再将 `PRODUCTION_FILE_SERVICE_URL`、`PRODUCTION_FILE_SERVICE_TOKEN` 配入本地 `.env`，先执行只读预演：

```sh
npm run pdf:sync:production --workspace=server
```

检查数据、资源数量和缺失文件提示无误后，再显式执行：

```sh
npm run pdf:sync:production --workspace=server -- --apply
```

同步脚本只迁移 `pdf_*` 原生 PDF 模块数据和对应资源；不会迁移旧 `Book` 图片模块或独立的 `column_*` 专栏模块。不要对已有 PDF 数据的正式库运行首次同步。

## 当前范围

本实现覆盖 PDF 原件、封面、页缩略图、PDF 错题裁图，以及数据库备份的创建、上传、列举、下载、删除、还原和自动清理。旧图片书籍 `Book` 模块与签名 URL/CDN 直连不在本次范围内。
