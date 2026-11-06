# Marble Run · 网页版弹珠撞墙游戏

Vue 3 前端、Node.js / Express API、PostgreSQL 16 数据库。**默认全部在 Docker 中运行**，前后端分离，界面为中文，支持键盘和触屏。

## 启动与停止

在 Windows 上启动 Docker Desktop（Linux 容器模式），然后双击根目录 **`start.bat`**。启动成功后打开 **http://localhost:5173**，点击「还没有档案？创建一个」注册。

启动脚本会生成根目录 `.env`、构建前后端镜像、启动三个容器，并等待健康检查通过。**正常使用不需要在本机安装 Node.js 或 PostgreSQL。** 首次构建需联网下载镜像及 npm 依赖。

双击 **`stop.bat`** 停止。停止会移除容器，但保留数据库数据卷；再次启动后账号、成绩和进度仍在。

也可以在项目目录执行：

```powershell
# 第一次运行：生成数据库密码和 JWT 密钥（已有 .env 不会被覆盖）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-docker.ps1

# 构建并启动全部服务
docker compose up -d --build --wait

# 查看状态 / 日志
docker compose ps
docker compose logs -f --tail=100

# 停止并保留数据库
docker compose down
```

已有镜像且代码未改变时，`docker compose up -d --wait` 可以直接启动。修改前端或后端代码后重新执行带 `--build` 的命令。其他系统可复制 `.env.example` 为 `.env`、填写随机密码和至少 32 字符的 JWT 密钥，再使用相同的 Compose 命令。

## 三个容器

| 服务 | 作用 | 本机入口 |
| --- | --- | --- |
| `web` / `marble-run-web-1` | Nginx 托管 Vue 构建产物，代理 `/api` | http://localhost:5173 |
| `api` / `marble-run-api-1` | Node.js 22 + Express，非 root 用户运行 | http://localhost:3000/api/health |
| `postgres` / `marble-run-postgres-1` | PostgreSQL 16 | `127.0.0.1:5432` |

浏览器 → `web:80` → `/api` 转发到 `api:3000` → `postgres:5432`。所有宿主机端口仅绑定 `127.0.0.1`。容器通过 Compose 内部网络互访，API 在容器中监听 `0.0.0.0`。启动顺序由健康检查控制：数据库就绪 → API 就绪 → 前端就绪。

前端镜像分两阶段构建：先用 Node 编译 Vue，再只把 `dist` 交给 Nginx；运行阶段没有 Vite 开发服务器。后端镜像仅安装运行依赖。`.dockerignore` 排除本机 `node_modules`、数据库目录、密钥及测试产物。

镜像默认使用 **Amazon ECR Public 的 Docker Official Images 镜像源**，解决本机无法连接 Docker Hub 的问题：`public.ecr.aws/docker/library/...`。需要使用 Docker Hub 时，可在 `.env` 中设置 `POSTGRES_IMAGE=postgres:16-alpine`、`NODE_IMAGE=node:22-alpine`、`NGINX_IMAGE=nginx:1.28-alpine`。

## 数据与配置

- Docker 数据保存在命名卷 **`marble-run_marble_pgdata`** 中，数据库名 `marble_game`，用户名 `marble`。
- 数据库密码和 JWT 密钥保存在根目录 `.env`，自动生成，不进入镜像或 Git。
- `.env` 中 `WEB_PORT`、`API_PORT`、`DB_PORT` 可修改宿主机端口；容器内部仍使用 80、3000、5432。
- `server/.env` 只供本机开发模式使用，Docker 不读取或复制它。
- 不要使用 `docker compose down -v` 来日常停止，`-v` 会删除数据库数据卷。已有卷的数据库密码不会随 `.env` 自动修改。

首次克隆项目时，数据库为空，需自行注册账号。数据库文件、备份、登录密钥和测试产物都不包含在源码仓库中。如需从旧的本机模式迁移数据，应先用 `pg_dump` 备份，再导入 Docker 数据库；两种模式的数据不会自动同步。

备份当前 Docker 数据库（使用文件复制，避免 PowerShell 二进制重定向损坏备份）：

```powershell
New-Item -ItemType Directory -Force .local/backups
docker compose exec -T postgres pg_dump -U marble -d marble_game -Fc -f /tmp/marble_game.dump
docker compose cp postgres:/tmp/marble_game.dump .local/backups/marble_game.dump
```

## 游戏与难度

点击「开始本关」，用 **W/A/S/D 或方向键**施加加速度，**空格刹车**，**Esc 暂停**。弹珠撞墙会反弹，进入右侧绿色光圈即可通关。触屏提供方向键与刹车键。切换页面或浏览器失焦会暂停，暂停时间不计入成绩；刷新会结束当前操作过程，已保存成绩仍保留。

共有 12 个关卡，必须依次解锁。路线逐渐复杂，同一水平下速度上限和加速度逐关提高。后端根据通关耗时、碰撞次数和放弃情况更新水平分，为下次开局选择参数：

| 水平分 | 自动匹配 | 体验 |
| --- | --- | --- |
| 低于 950 | 辅助节奏 | 更低速度、更强减速、更小弹珠 |
| 950–1199 | 均衡节奏 | 标准惯性与速度 |
| 1200 及以上 | 进阶节奏 | 更高速度、更强惯性 |

初始水平分 1000，按 `65% 原水平 + 35% 本次表现` 平滑更新，范围 600–1800。快速完成且碰撞较少会提高评分，较慢或频繁碰撞会降低评分。开局超过 10 秒后放弃会适当降低评分；立即误点重玩不扣分。单次有效操作上限 15 分钟，可反复挑战已解锁关卡。

## 计时与排名

- 物理引擎采用 120 Hz 固定步长；浏览器记录输入，API 重放操作并确认抵达终点后计算成绩。
- 服务端检查解锁、挑战所属用户、时间与输入序列，重复提交同一次挑战不会重复计分。
- 每次完成保留历史，每关只取个人最佳时间排名；重玩不增加已通关数。
- 排序先比较**不同关卡的通关数量（降序）**，再比较**这些关卡的最佳耗时总和（升序）**，两者相同则并列。
- 完成全部 12 关的玩家排在未完成玩家之前，按最佳总耗时形成最终名次。
- 总榜展示前 100 人；本人排名在完整榜单独立计算，超过 100 名也可查看。
- 各自动难度共用总榜，成绩保留难度档位。回放验证能校验游戏规则，但不能判断输入是否由真人产生。

## 项目结构

```text
client/                 Vue 页面、样式、前端 Dockerfile
server/src/app.js       注册登录、进度、挑战、排名 API
server/src/index.js     数据库连接、表初始化、服务启动
server/schema.sql       用户、挑战、成绩三张表
server/Dockerfile       API 镜像
shared/game.js          关卡、物理、评分与回放校验
docker/nginx.conf       静态资源与 API 代理配置
docker-compose.yml      三个服务、健康检查、内部网络与数据卷
scripts/                Docker 启停、密钥生成；保留本机开发脚本
tests/                  API、物理、浏览器测试
```

密码经 bcrypt 哈希保存，JWT 有效期 7 天，SQL 使用参数化查询，成绩保存采用事务。同一账号只能有一个有效挑战，新标签页开局会结束旧挑战。

| 接口 | 用途 |
| --- | --- |
| `POST /api/auth/register`、`POST /api/auth/login` | 注册、登录 |
| `GET /api/me`、`GET /api/progress` | 当前用户、进度与推荐节奏 |
| `POST /api/attempts` | 创建挑战 |
| `POST /api/attempts/:id/abandon` | 结束未完成挑战 |
| `POST /api/results` | 验证操作并保存成绩 |
| `GET /api/results/me` | 最近 50 条个人成绩 |
| `GET /api/leaderboard` | 全站前 100 名 |
| `GET /api/ranking/me` | 完整榜单中的本人排名 |

## 开发与测试

开发和自动化测试可选用本机 Node.js 22+。PowerShell 中使用 `npm.cmd` 可避开 `npm.ps1` 执行策略限制：

```powershell
npm.cmd install
npm.cmd run install:all
npm.cmd test           # API 测试使用独立临时 schema，完成后清理
npm.cmd run test:e2e   # 需三个服务运行和本机 Microsoft Edge，临时账号会清理
npm.cmd run build     # 在本机构建 Vue；正常部署由 Docker 完成构建
```

测试默认从根目录 `.env` 读取 Docker 数据库连接信息，也可用 `TEST_DATABASE_URL` 指向测试数据库。测试涵盖注册登录、越级拦截、无效成绩、幂等提交、个人排名超过 100、重复关卡计数、水平调整、碰撞和全部关卡连通性。浏览器测试通过 Nginx 真实完成首关、保存、解锁、刷新、暂停和移动端检查。

原本的纯本机开发模式保留在 `scripts/start-local.ps1`、`scripts/stop-local.ps1`，需要 Node.js。默认 `start.bat` / `stop.bat` 已改为 Docker。两种模式使用独立数据库，不要同时占用相同端口。如需回到本机开发，应先停止 Docker，再启动本机模式。
