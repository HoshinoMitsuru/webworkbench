# ECS 部署说明

面向：把工作台部署到机构自己的阿里云 / 腾讯云 ECS，供机构内成员通过浏览器访问，活动数据留在机构服务器上。

部署形态：单台 ECS + Docker Compose + Nginx 反向代理，应用与 SQLite 数据库同机，数据目录挂载到宿主机 `./data`。

## 1. 服务器准备

- 配置建议：2 核 4 GB 起，系统盘 40 GB 以上；Ubuntu 22.04 / Debian 12 / Alibaba Cloud Linux 3 均可。
- 安全组放行：`22`（运维）、`80`、`443`。不要对公网开放 `3000`。
- 安装 Docker 与 Compose 插件：

```bash
curl -fsSL https://get.docker.com | sh
sudo systemctl enable --now docker
docker compose version
```

国内 ECS 如拉取镜像慢，可在 `/etc/docker/daemon.json` 配置镜像加速后再 `systemctl restart docker`。

## 2. 上传代码并配置

```bash
# 本机打包（排除依赖与数据）
tar --exclude=node_modules --exclude=.next --exclude=data -czf workbench.tar.gz workbench
scp workbench.tar.gz root@<ECS_IP>:/opt/

# ECS 上
cd /opt && tar -xzf workbench.tar.gz && cd workbench
cp .env.example .env
mkdir -p data
```

编辑 `.env`：

```ini
AUTH_SECRET=<32 位以上随机串，可用 openssl rand -hex 32 生成>
ARK_API_KEY=<方舟 Key>
ARK_MODEL=<接入点 ID 或模型 ID>
DATA_DIR=/app/data
```

> `AUTH_SECRET` 一旦投入使用不要随意更换，更换会让所有人重新登录。

## 3. 启动与建号

```bash
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1/api/health
```

`/api/health` 返回 `{"ok":true,"db":"ok",...}` 表示应用与数据库都正常。

创建账号（每个成员一个，便于区分最后编辑人）：

```bash
docker compose exec app node scripts/create-user.mjs zhangsan 'Passw0rd2026' 张三
```

也可以把 `SEED_USERS=zhangsan:Passw0rd2026:张三,lisi:Passw0rd2026:李四` 写进 `.env`，首次启动自动创建；账号已存在后该配置不再生效。

浏览器访问 `http://<ECS_IP>/`，用刚创建的账号登录。

不需要示例数据。生产默认不部署 `examples/`，页面上的「载入示例资料」会自动隐藏；如需临时演示，把仓库根目录的 `examples/` 上传到 ECS 并挂载：

```yaml
# docker-compose.yml 的 app 服务下
volumes:
  - ./data:/app/data
  - ../examples:/app/examples:ro
```

## 4. 配置 HTTPS（强烈建议）

登录 Cookie 会根据访问协议自动加 `Secure`：HTTPS 访问时自动安全、HTTP 访问时仍可登录，因此不配置证书也能先用起来。但账号密码与活动资料会在公网明文传输，正式对外使用前请配置证书，任选一种：

### 方案 A：宿主机已有 Nginx / 使用云厂商证书

1. 把 `docker-compose.yml` 中 nginx 的端口映射改为 `127.0.0.1:8080:80`，只允许宿主机访问。
2. 宿主机 Nginx 监听 443，反向代理到 `127.0.0.1:8080`，并加载证书。
3. 安全组关闭 80 或只用于跳转 443。

### 方案 B：容器内使用 Let's Encrypt

在 `nginx.conf` 中增加 443 server 块并挂载证书目录，然后重新 `docker compose up -d`。

```nginx
server {
    listen 443 ssl;
    server_name workbench.example.org;
    ssl_certificate     /etc/nginx/certs/fullchain.pem;
    ssl_certificate_key /etc/nginx/certs/privkey.pem;

    location / {
        proxy_pass http://app:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 180s;
    }
}
```

并在 compose 中挂载 `./certs:/etc/nginx/certs:ro`、映射 `443:443`。

> 正式对外使用前，域名需完成 ICP 备案（境内 ECS）。

## 5. 日常运维

```bash
docker compose logs -f app        # 查看应用日志
docker compose restart app        # 重启应用
docker compose up -d --build      # 更新代码后重建
```

审计信息在数据库 `audit` 表：登录、创建、修改、删除都会留痕，不含活动正文。

## 6. 备份与恢复

数据库文件在宿主机 `./data/`：

```bash
# 在线备份（推荐，SQLite 自带一致性备份）
docker compose exec app sh -c 'node -e "const D=require(\"better-sqlite3\");const db=new D(process.env.DATA_DIR+\"/workbench.db\");db.backup(\"/app/data/backup-$(date +%F).db\").then(()=>console.log(\"ok\"))"'

# 或整目录打包（需先停服，确保 WAL 落盘）
docker compose stop app
tar -czf backup-$(date +%F).tar.gz data
docker compose start app
```

恢复：

```bash
docker compose stop app
cp backup-2026-11-20.db data/workbench.db
rm -f data/workbench.db-wal data/workbench.db-shm
docker compose start app
```

建议用 ECS 快照或定时任务每天备份，并把备份同步到对象存储。

## 7. 常见问题

| 现象 | 原因与处理 |
|---|---|
| 登录后立刻跳回登录页 | 常见原因是更换了 `AUTH_SECRET` 或换了域名，旧 Cookie 失效。重新登录即可；确认部署后 `AUTH_SECRET` 不再变动 |
| 登录页提示「尚未创建账号」 | 还没建号，执行第 3 步的 `create-user` |
| `/api/health` 返回 503 | `./data` 目录权限或磁盘问题，检查 `docker compose logs app` |
| 保存提示版本冲突 | 同事已更新了同一条活动，按提示载入最新版本或覆盖 |
| 生成报「模型返回结构不完整」 | 方舟接入点 ID / 额度问题，检查 `ARK_MODEL` 与应用日志 |
| 80 端口被占用 | ECS 上已有 Nginx 等服务，改用方案 A 或调整端口映射 |

## 8. 升级与迁移

- 升级：上传新代码 → `docker compose up -d --build`。数据库表结构由应用启动时自动补齐，`data/` 不受影响。
- 迁移服务器：停止旧机 → 拷贝整个 `data/` → 新机启动 → 修改 DNS / 安全组。
