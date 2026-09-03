# EdgeOne Pages 全栈部署指南

## 目录结构说明

```
edgeone-deploy/                    # 部署根目录
├── cloud-functions/
│   └── api/
│       └── [[default]].js         # Express 全栈 API 入口，处理 /api/* 请求
├── src/
│   ├── config.js                  # 共享配置（从环境变量读取）
│   ├── db.js                      # Supabase 数据库适配层
│   ├── middleware/
│   │   └── auth.js                # 认证中间件（requireAuth/requireAdmin）
│   ├── routes/
│   │   ├── auth.js                # 认证路由（注册/登录/登出/账户管理）
│   │   ├── admin.js               # 管理员路由
│   │   ├── history.js             # 历史记录路由
│   │   ├── workflow.js            # 任务 CRUD + Coze 工作流代理
│   │   └── legacy.js              # 遗留路由（简化版）
│   └── coze/
│       ├── client.js              # Coze API 客户端
│       └── sse.js                 # SSE 流解析器
├── images/                        # 静态图片资源
├── _routes.json                   # EdgeOne 路由配置
├── package.json                   # 依赖配置
├── .env.example                   # 环境变量模板
├── dev-server.js                  # 本地开发服务器（不上传 EdgeOne，通过 _routes.json 排除）
└── *.html / *.js / *.css          # 前端静态文件
```

## 部署步骤

### 1. 准备工作

1. 创建 Supabase 项目（免费层即可）：https://supabase.com
2. 在 Supabase SQL Editor 中执行建表 SQL（见下方）
3. 获取 Supabase URL 和 anon key

### 2. Supabase 建表 SQL

在 Supabase 项目的 SQL Editor 中执行：

```sql
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    designer_id TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT,
    display_name TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_disabled INTEGER NOT NULL DEFAULT 0,
    gen_count INTEGER NOT NULL DEFAULT 0,
    last_gen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    prompt TEXT, title TEXT, thumbnail TEXT,
    image_urls TEXT, doc_id TEXT, status TEXT, options TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    params TEXT NOT NULL DEFAULT '{}',
    result TEXT DEFAULT '{}',
    conversation TEXT DEFAULT '{}',
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_history_user ON history(user_id);
CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
```

### 3. 上传到 EdgeOne Pages

1. 登录 EdgeOne Pages 控制台
2. 创建新项目或选择已有项目
3. 上传方式：选择「上传文件」
4. 上传内容：**选择 `edgeone-deploy/` 目录下的所有文件和子目录**（不要上传目录本身）
   - 包括：`cloud-functions/`, `src/`, `images/`, `_routes.json`, `package.json`, 所有 HTML/CSS/JS 文件
   - **注意**：`dev-server.js` 通过 `_routes.json` 的 `exclude` 排除，不会参与云函数构建
5. 输出目录：**留空**（不要填 '.' 或 '/dist'）
6. 框架预设：Node.js
7. 构建命令：**留空**（无需构建命令，EdgeOne 会自动检测 package.json 并安装依赖）
8. 输出目录：留空

> **重要：如果构建仍然失败，请在 EdgeOne 控制台项目设置中检查以下配置：**
> - 确保 Node.js 版本 >= 18（在项目设置中可配置）
> - 确保构建命令为空（EdgeOne 自动处理依赖安装）
> - 如果看到 `Top-level await` 错误，请确认没有上传 `index.js` 文件（已重命名为 `dev-server.js`）

### 4. 配置环境变量

在 EdgeOne Pages 控制台 → 项目设置 → 环境变量，添加以下变量：

| 变量名 | 说明 | 必填 |
|--------|------|------|
| `SUPABASE_URL` | Supabase 项目 URL | 是 |
| `SUPABASE_ANON_KEY` | Supabase anon key | 是 |
| `KM_COZE_TOKEN` | Coze API Token | 是 |
| `KM_WORKFLOW_ID` | Coze 工作流 ID | 是 |
| `ADMIN_DESIGNER_ID` | 管理员账号（注册后自动提升） | 否 |

### 5. 部署验证

部署完成后，访问以下 URL 验证：

1. `https://your-domain.edgeone.cool/` - 首页
2. `https://your-domain.edgeone.cool/api/register` - API 注册接口（应返回 400 或 JSON）
3. `https://your-domain.edgeone.cool/login.html` - 登录页面
4. `https://your-domain.edgeone.cool/tailwind.css` - CSS 样式文件（应返回 200）

## 重要说明

### 数据库迁移说明

- **SQLite → Supabase**：原项目使用 `better-sqlite3`（本地文件数据库），EdgeOne Pages 环境不支持。
- 所有数据库操作已适配为 Supabase JavaScript API。
- 现有数据不会自动迁移，需要手动导出导入。

### 遗留功能说明

- `check-status` / `start-workflow`：旧版非流式工作流，已简化。
- `generate-document` / `download`：文档生成功能依赖于 Google Apps Script 和 Vercel Blob，在 EdgeOne 环境中功能受限。
- 建议使用新版流式工作流 API（`/api/workflow/start` 和 `/api/workflow/resume`）。

### 附：导出原有 SQLite 数据

如需将原有 `data.db` 中的数据迁移到 Supabase：

```bash
# 使用 sqlite3 命令行导出
sqlite3 data.db ".mode json" ".output users.json" "SELECT * FROM users;"
sqlite3 data.db ".mode json" ".output sessions.json" "SELECT * FROM sessions;"
sqlite3 data.db ".mode json" ".output history.json" "SELECT * FROM history;"
sqlite3 data.db ".mode json" ".output tasks.json" "SELECT * FROM tasks;"
```

然后将 JSON 文件导入 Supabase 对应表。