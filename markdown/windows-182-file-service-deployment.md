# 182 Windows 文件服务部署操作单

## 目标与边界

在 182 Windows VPS 上运行独立文件服务，当前只监听本机 `127.0.0.1:4010`，供同机应用访问。文件服务代码位于 `server/src/storage/fileService.ts`，包含认证、上传、下载（含 Range）、列举、检查和删除。

本操作单不迁移数据库、不执行 PDF 数据同步、不改旧图片书籍模块，也不把 4010 暴露到公网。若应用之后迁到 67，另行配置 HTTPS 反向代理和来源 IP 限制。

**版本注意：** 已推送的 `feature/pdf-native` 提交 `d898df5` 包含文件服务和主 PDF 远端存储。数据库备份远端接入当时仍是未推送的本地改动；在确认对应代码已经提交并部署前，不要把备份功能当作已上线能力。

## 给服务器 AI 的执行约束

- 在 182 本机的 VS Code / PowerShell 中执行；不要把 RDP 密码、服务令牌或 `.env` 内容贴到任何聊天。
- 先检查当前目录、分支、提交和已有服务。不要覆盖现有仓库、停止现有应用或删除任何资源。
- 只按本操作单配置文件服务。不要执行 `db:init:production`、`pdf:sync:production -- --apply`、Prisma schema push 或数据库还原。
- 不要输出或记录 `FILE_SERVICE_TOKEN`；不要提交 `server/.env`。
- 如果端口被占用、存储目录已有未知内容、分支不是目标版本或步骤需要重启现有服务，先停止并报告，不要自行猜测。

## 1. 连接并检查主机

在 RDP 桌面打开 PowerShell，检查：

```powershell
node --version
npm --version
git --version
```

要求 Node.js 20 或 22。若尚无项目目录，从仓库的授权 Git 远端克隆 `feature/pdf-native`；若目录已存在，先检查工作区和分支，不要覆盖本地修改：

```powershell
git status --short --branch
git log -1 --oneline
```

部署文件服务所需代码至少应包含提交 `d898df5`。进入仓库根目录后安装依赖并验证：

```powershell
npm ci
npm run build:server
npm run test:storage --workspace=server
```

测试通过后再继续。

## 2. 准备资源目录和令牌

选择一个稳定、空间足够的本机磁盘目录，例如：

```text
D:/EduWorkspaceStorage
```

确认运行文件服务的 Windows 账号对该目录有读写权限。不要把它放在临时目录或会断开的网络映射盘。

生成至少 32 字节的随机令牌并只保存在服务器本机。不要在聊天中发送或展示该值。编辑 `server/.env`（不要改 `.env.example`），设置：

```dotenv
STORAGE_DIR=D:/EduWorkspaceStorage
FILE_SERVICE_HOST=127.0.0.1
FILE_SERVICE_PORT=4010
FILE_SERVICE_TOKEN=<本机生成的随机令牌>
```

若仓库内没有 `server/.env`，从 `server/.env.example` 复制一份后编辑。检查 `.env` 被 Git 忽略：

```powershell
git check-ignore server/.env
```

此阶段不要改数据库连接串或运行任何数据库脚本。

## 3. 启动文件服务并验证

在仓库根目录运行：

```powershell
npm run start:storage --workspace=server
```

先保持该窗口运行。另开 PowerShell 窗口验证健康检查和监听端口：

```powershell
Invoke-RestMethod http://127.0.0.1:4010/health
Test-NetConnection 127.0.0.1 -Port 4010
```

`/health` 应返回 `status: ok`，TCP 检查应成功。`/v1` API 需要 Bearer 令牌；不要在命令历史或聊天中明文写入令牌。配置好同机应用后，可从 PDF 管理页检查存储状态并初始化目录。

## 4. 配置同机应用

如果应用也部署在 182，在应用使用的 `server/.env` 中设置相同的服务令牌：

```dotenv
PDF_STORAGE_MODE=http
PDF_STORAGE_API_URL=http://127.0.0.1:4010
PDF_STORAGE_TOKEN=<与 FILE_SERVICE_TOKEN 相同的值>
```

文件服务进程和应用进程应使用同一份 `.env`，或分别配置相同的目录/令牌。重启应用后，在 PDF 管理页检查存储状态、初始化目录，再做测试导入。

请用一份可丢弃的测试 PDF 验证：导入、打开、跳到较后页（Range 分段读取）、封面/缩略图读取、错题裁图上传和删除。确认成功后再导入正式数据。

## 5. 保持服务运行

当前仓库提供启动命令，没有内置 Windows Service 安装程序。先用现有的进程管理工具或经批准的 Windows 服务/任务计划方式配置开机启动，并确认：

- 工作目录是仓库根目录（npm workspace 命令）；
- 服务运行账号有目录读写权限；
- 服务异常退出会被发现并重启；
- 重新登录/注销 RDP 后服务仍按预期运行。

不要为了验证而重启正在承载业务的应用。完成配置前，保持当前 PowerShell 服务窗口开启。

## 安全与停止条件

- 182 同机部署时保留 `FILE_SERVICE_HOST=127.0.0.1`，不要添加公网入站规则，也不要通过路由器或云防火墙开放 4010。
- 不要将 HTTP 文件服务直接用于 67 到 182 的跨机访问。跨机时必须先配置 HTTPS 反向代理，并限制来源为应用主机。
- 不要在现有数据库上运行“空库初始化”脚本。正式 PDF 同步前需另行检查目标表状态、数据备份和用户 ID 对齐。
- 若任何测试需覆盖已有文件、改数据库或停止现有服务，先向用户确认。

## 部署完成回报

只汇报非敏感信息：部署分支/提交、Node 版本、构建和测试结果、文件服务是否监听 `127.0.0.1:4010`、健康检查结果、资源目录是否可写。不要回报令牌、数据库密码或 RDP 凭据。
