# Debian VPS 部署

本指南把应用部署到 Debian 上，通过现有 Nginx 提供前端并反代 API。首次配置后，从本机运行 `npm run deploy:vps` 即可拉取代码、安装依赖、构建并重启服务。此流程不改数据库 schema、不清理 storage，也不配置 Cloudflare。

## 部署结构

- Node.js API 只监听 `127.0.0.1:4000`，由 systemd 管理。
- Nginx 初始只监听 `127.0.0.1:8080`，不会从公网提供站点。
- 数据库通过 `DATABASE_URL` 连接；书籍 storage 放在 `/var/lib/edu-workspace/storage`。
- 本机通过 SSH 隧道访问，身份验证完成后再开放域名和 Cloudflare。

## 1. Debian 一次性准备

先确认 Debian 版本、VPS 公网 IP、SSH 登录方式，以及数据库 IP `182.*` 对 VPS 开放了 MySQL 访问。数据库防火墙应只允许 VPS 的固定出口 IP，不能把 MySQL 端口开放给所有公网地址。

在 VPS 上创建专用发布用户，安装 Nginx、Git、curl、flock 和 Node.js 22（建议至少 Node 22.12）：

```bash
sudo apt update
sudo apt install -y nginx git curl util-linux
```

Node.js 需从可信的 Node.js 官方安装渠道安装。确认 `node --version` 和 `npm --version` 后再继续。不要使用 Debian 仓库中可能过旧的 Node.js 版本。

创建用户和持久化资源目录：

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo install -d -o deploy -g deploy /opt/edu-workspace
sudo install -d -o deploy -g deploy /var/lib/edu-workspace/storage
sudo install -d -o root -g root -m 700 /etc/edu-workspace
```

把本机用于部署的 SSH **公钥**添加到 VPS 用户 `deploy` 的 `~/.ssh/authorized_keys`。不要复制私钥到 VPS，也不要把私钥提交到仓库。

以 `deploy` 用户将仓库克隆到固定目录（把 URL 替换成你的 GitHub 仓库地址）：

```bash
sudo -u deploy git clone <repository-ssh-url> /opt/edu-workspace
```

如果仓库是私有的，VPS 上的 `deploy` 用户也需要自己的只读 GitHub SSH key，并将公钥添加到 GitHub。不要复用或上传本机私钥。

## 2. 配置运行环境和数据库

创建 `/etc/edu-workspace/edu-workspace.env`，用实际值替换占位符：

```dotenv
PORT=4000
CLIENT_ORIGIN=http://localhost:8080,http://127.0.0.1:8080
DATABASE_URL=mysql://<db-user>:<url-encoded-password>@<database-host>:3306/<database-name>
STORAGE_DIR=/var/lib/edu-workspace/storage
AUTH_ENABLED=true
JWT_SECRET=<long-random-secret>
JWT_REFRESH_SECRET=<another-long-random-secret>
```

如果数据库在 `182.*`，将 `<database-host>` 填为对应数据库 IP；密码中的 `@`、`#`、`/` 等字符要按 URL 规则编码。生成足够长的随机 secret，不要把环境文件放进仓库：

```bash
sudo nano /etc/edu-workspace/edu-workspace.env
sudo chown root:root /etc/edu-workspace/edu-workspace.env
sudo chmod 600 /etc/edu-workspace/edu-workspace.env
```

首次部署使用专用的空数据库。先确认数据库 schema 已按项目要求初始化，再启动应用。项目有历史表和手工维护的 SQL；**不要在已有数据库上运行 `prisma db push`，也不要把它加入日常部署脚本**。如果 `182.*` 上的库已有数据，先确认库名、schema 和备份，再连接，不能把它当作空库。

默认认证是启用的；已有用户才能登录。若只需在 SSH 隧道内短暂验证页面且空库尚未建用户，可将 `AUTH_ENABLED=false`，但此模式无权限隔离，务必保持 Nginx 仅监听 loopback，完成登录配置后再改回 `true`。不要运行仓库里用于本机开发的旧 seed 脚本。

## 3. 安装 systemd 服务和私有 Nginx 站点

安装仓库中的服务配置：

```bash
sudo cp /opt/edu-workspace/deploy/edu-workspace-vps.service /etc/systemd/system/edu-workspace.service
sudo cp /opt/edu-workspace/deploy/nginx-vps-private.conf /etc/nginx/sites-available/edu-workspace-private
sudo ln -s /etc/nginx/sites-available/edu-workspace-private /etc/nginx/sites-enabled/edu-workspace-private
sudo nginx -t
sudo systemctl daemon-reload
```

如果 Nginx 报重复 `server_name` 或端口冲突，先检查已有站点配置，不要覆盖或删除其他站点。服务模板使用 `/opt/edu-workspace` 和 `deploy` 用户；若更换路径或用户名，要同步修改模板与 `VPS_APP_DIR`。

给发布用户仅限重启本服务的免密码权限：

```bash
sudo visudo -f /etc/sudoers.d/edu-workspace-deploy
```

写入以下一行（先通过 `command -v systemctl` 确认 Debian 上 systemctl 的路径）：

```text
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart edu-workspace.service, /usr/bin/systemctl status --no-pager edu-workspace.service
```

保存后验证：

```bash
sudo chmod 440 /etc/sudoers.d/edu-workspace-deploy
sudo visudo -cf /etc/sudoers.d/edu-workspace-deploy
sudo systemctl enable --now nginx
sudo nginx -t && sudo systemctl reload nginx
```

首次构建并启动：

```bash
sudo -u deploy -H bash -lc 'cd /opt/edu-workspace && npm ci --no-audit --no-fund && npx prisma generate --schema server/prisma/schema.prisma && npm run build:prod'
sudo systemctl enable --now edu-workspace.service
curl http://127.0.0.1:4000/api/health
curl -I http://127.0.0.1:8080/
```

如果 API 无法启动，先检查数据库可达性、schema、环境文件和日志：

```bash
sudo journalctl -u edu-workspace.service -n 100 --no-pager
```

## 4. SSH 隧道私下访问

保持 VPS 防火墙只允许必要的 SSH 访问；不要为这个临时站点开放 8080。由本机建立隧道：

```bash
ssh -N -L 8080:127.0.0.1:8080 deploy@<vps-ip>
```

隧道运行期间，在本机浏览器打开 <http://localhost:8080>。这个地址只通过 SSH 隧道访问，不需要 DNS 或 Cloudflare。

## 5. 日常一键发布

本机需已能通过 SSH 访问 VPS，VPS 上的 `deploy` 用户需能读取 GitHub 仓库。先把要发布的提交推送到对应 Git 分支，然后在仓库根目录运行：

```bash
npm run deploy:vps -- deploy@<vps-ip>
```

默认发布本机当前 Git 分支；也可以指定分支：

```bash
npm run deploy:vps -- deploy@<vps-ip> main
```

如果远端目录不是 `/opt/edu-workspace`：

```bash
VPS_APP_DIR=/srv/edu-workspace npm run deploy:vps -- deploy@<vps-ip> main
```

命令会拒绝覆盖远端未提交改动，并执行 `git fetch`、快进更新、`npm ci`、Prisma Client 生成、生产构建、systemd 重启和健康检查。部署失败时查看 `sudo journalctl -u edu-workspace.service -n 100 --no-pager`。它不会自动迁移数据库或移动书籍文件。

## 6. 之后开放域名与 Cloudflare

登录验证准备好之前，不要把 Nginx 改成公网监听，也不要开放 80/443。之后开放时，再将 Nginx `server_name`、HTTPS 证书和 `CLIENT_ORIGIN` 改为正式域名，并验证应用登录和权限隔离；随后再把 DNS 接入 Cloudflare，并设置 SSL/TLS 为 **Full (strict)**。不要使用 Flexible 模式。

书籍文件和数据库迁移是独立步骤：先分别备份当前数据库与 storage，再计划传输和校验；不要把大体积书籍文件放进 Git 部署流程。
