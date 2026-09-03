# Kosy Mosy · 香水设计工坊 🌸

> AI 驱动的香水包装设计平台，基于 Coze 三步工作流，从文字构思到多角度预览图一站式生成。

一款面向香水设计师的 AI 设计辅助工具，输入文字描述香水概念，由 **Coze 三步工作流** 驱动：

1. **规范梳理** → 解析产品描述 → 输出结构化设计规范（产品信息、包装风格、灯光要求）
2. **预览生成** → 根据规范生成预览图 → 确认满意后进入下一步
3. **多角度生成** → 基于预览图和规范，生成多角度展示图

## ✨ 功能特点

- 🎨 **三步工作流**：规范梳理 → 预览图生成 → 多角度生成，每步可取消、可重试
- 🔄 **并行任务支持**："开始构思"按钮全程可点击，支持同时运行多个任务
- 🌊 **实时状态推送**：SSE 推送工作流每个节点的开始/完成/错误，前端实时渲染
- 👤 **完整账号体系**：注册/登录/登出，历史记录按账号隔离
- 📝 **任务管理**：任务列表卡片展示，显示进度、耗时、三步指示器，支持点击查看、删除
- 🖼️ **结果展示区**：预览图 + 多角度图网格展示，支持弹窗确认、下载
- 🛡️ **管理员后台**：用户列表、统计数据、禁用/启用账号、重置密码
- 📱 **响应式设计**：适配桌面、平板、移动端
- 🎨 **本地 Tailwind 构建**：不依赖 CDN，全本地 CSS

## 🏗️ 技术架构

| 层级 | 技术栈 |
|------|--------|
| **后端** | Node.js + Express 5 |
| **数据库** | SQLite (better-sqlite3) |
| **前端** | Vanilla JavaScript + Tailwind CSS |
| **AI 工作流** | Coze Workflow API |
| **部署** | 支持原生 Node.js、EdgeOne Pages Functions、云函数 |

## 📁 项目结构

```
coze-workflow-app/
├── index.js                  # Express 服务器入口
├── db.js                     # SQLite 数据库操作（用户/会话/任务）
├── db-cli.js                 # 数据库命令行工具
├── tailwind.config.js        # Tailwind CSS 配置
├── src/
│   ├── config.js             # 配置读取（Coze 工作流 ID 等）
│   ├── input.css             # Tailwind 源样式
│   ├── coze/
│   │   ├── client.js         # Coze API 客户端
│   │   └── sse.js            # SSE 流式事件解析
│   ├── middleware/
│   │   └── auth.js           # JWT 认证中间件
│   └── routes/
│       ├── admin.js          # 管理员接口
│       ├── auth.js           # 注册/登录接口
│       ├── history.js        # 历史记录接口
│       └── workflow.js       # 三步工作流接口（核心）
├── frontend/                # 前端文件
│   ├── images/               # 装饰图片、logo
│   ├── 500.html              # 500 错误页面
│   ├── about.html            # 关于页面
│   ├── account.html          # 账号资料页
│   ├── admin.html            # 管理员后台
│   ├── history.html          # 历史记录页
│   ├── index.html            # 首页
│   ├── login.html            # 登录页
│   ├── studio.html           # 设计工坊主界面（核心）
│   ├── tasks.html            # 任务列表页
│   ├── page-transition.js   # 页面切换动画
│   ├── script.js             # 前端业务逻辑
│   ├── style.css             # 自定义样式
│   └── tailwind.css          # Tailwind 构建产物
├── edgeone-deploy/           # EdgeOne Pages Functions 部署适配
├── cloud-functions/          # 云函数部署适配
├── package.json
├── .env.example              # 环境变量示例
└── README.md
```

## 🚀 快速开始

### 环境要求

- Node.js ≥ 18
- npm ≥ 9

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env.local` 并填写：

```bash
# Coze API（必需）
COZE_TOKEN=pat_your_coze_token_here
COZE_APP_ID=your_coze_app_id
KM_WORKFLOW_ID=7679265032790327336  # 第一步：规范梳理
KM_PREVIEW_WORKFLOW_ID=7679271460304764991  # 第二步：预览生成
KM_MULTI_WORKFLOW_ID=7679274717424959522  # 第三步：多角度生成

# 服务器（可选）
PORT=3000
NODE_ENV=development
```

> **工作流参数要求**：
> - 第一步 `step/spec`：输入 `user_input` → 输出 `spec` JSON
> - 第二步 `step/preview`：输入 `spec` + `image`（参考图 URL 或 file_id）→ 输出 `preview_prompt` + `image_url`
> - 第三步 `step/multi`：仅接受 `input`（第二步的 `preview_prompt`）+ `image`（第二步输出图片 URL）

### 3. 构建 Tailwind CSS

```bash
npm run build:css
```

开发时可用监听模式自动重建：

```bash
npm run watch:css
```

### 4. 启动服务器

```bash
npm run dev
```

打开浏览器访问 http://localhost:3000

> 首次启动会自动创建 `data.db` 数据库文件。

## ⚙️ 环境变量说明

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `COZE_TOKEN` | 是 | Coze Personal Access Token |
| `COZE_APP_ID` | 是 | Coze 应用 ID |
| `KM_WORKFLOW_ID` | 是 | 第一步工作流 ID（规范梳理） |
| `KM_PREVIEW_WORKFLOW_ID` | 是 | 第二步工作流 ID（预览生成） |
| `KM_MULTI_WORKFLOW_ID` | 是 | 第三步工作流 ID（多角度生成） |
| `JWT_SECRET` | 是 | JWT 签名密钥 |
| `PORT` | 否 | 服务端口，默认 `3000` |
| `NODE_ENV` | 否 | 运行环境 `development/production` |
| `DB_PATH` | 否 | 数据库路径，默认 `./data.db` |

## 🔑 初始管理员账号

首次启动后，需要通过数据库命令行创建管理员：

```bash
node db-cli.js create-admin admin@example.com your-password
```

## 📡 API 接口

### 认证

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| POST | `/api/auth/register` | 注册 | ❌ |
| POST | `/api/auth/login` | 登录 | ❌ |
| POST | `/api/auth/logout` | 登出 | ✅ |
| GET | `/api/auth/me` | 获取当前用户 | ✅ |

### 任务（三步工作流）

| 方法 | 路径 | 说明 | 鉴权 |
|------|------|------|------|
| GET | `/api/workflow` | 获取任务列表 | ✅ |
| POST | `/api/workflow` | 创建任务 | ✅ |
| PUT | `/api/workflow/:id` | 更新任务状态 | ✅ |
| DELETE | `/api/workflow/:id` | 删除任务 | ✅ |
| DELETE | `/api/workflow` | 清空所有任务 | ✅ |
| POST | `/api/workflow/step/spec` | 调用第一步：规范梳理 | ✅ |
| POST | `/api/workflow/step/preview` | 调用第二步：预览生成 | ✅ |
| POST | `/api/workflow/step/multi` | 调用第三步：多角度生成 | ✅ |
| POST | `/api/workflow/step/rollback` | 回退到指定步骤 | ✅ |
| POST | `/api/image` | 上传参考图到 Coze | ✅ |

## 🎯 三步工作流参数约定

### 第一步：规范梳理 (`/api/workflow/step/spec`)

**输入：**
```json
{
  "task_id": "uuid"
}
```

**输出：**
```json
{
  "success": true,
  "spec": { /* 结构化设计规范 JSON */ }
}
```

### 第二步：预览生成 (`/api/workflow/step/preview`)

**输入：**
```json
{
  "task_id": "uuid",
  "spec": {...},
  "ref_file_id": "optional-coze-file-id"
}
```

**输出：**
```json
{
  "success": true,
  "image_url": "https://...",
  "file_id": "coze-file-id",
  "prompt": "preview prompt text"
}
```

### 第三步：多角度生成 (`/api/workflow/step/multi`)

**输入：**
```json
{
  "task_id": "uuid",
  "reference_image_url": "https://..."
}
```

**输出：**
```json
{
  "success": true,
  "image_url": "https://..."
}
```

> **重要**：第三步 `image` 参数**必须是 URL**，不接受 file_id。`input` 参数来自**第二步 output1 提取的 preview_prompt**。

## 🚀 部署

### EdgeOne Pages Functions

本项目原生支持 [EdgeOne Pages Functions](https://cloud.tencent.com/document/product/1552/108590) 部署，所有代码已在 `edgeone-deploy/` 目录适配。

### 原生 Node.js

```bash
npm install
npm run build:css
npm start
```

### Docker

```bash
docker build -t coze-workflow-app .
docker run -p 3000:3000 --env-file .env.local coze-workflow-app
```

## 🐛 故障排除

| 问题 | 解决方案 |
|------|----------|
| `reference_prompt is not defined` | 已修复，请拉取最新代码 |
| `SQLITE_NOTADB` 错误 | 将 `DB_PATH` 置空，使用本地 `data.db` |
| `The input parameters provided to the model are invalid` | 检查第三步 `image` 参数是否为 URL，不能是 file_id |
| 任务执行时间从 480 分开始 | 已修复时区解析问题，请拉取最新代码 |
| 图片已生成但显示"尚未返回概念图" | 已修复 `multi_ready` 状态不渲染问题，请拉取最新代码 |
| `favicon.ico` 404 | 已通过 204 响应修复 |
| Tailwind CDN 警告 | 已改为本地构建，运行 `npm run build:css` |

## 🔒 安全特性

- JWT 认证，所有业务接口均需鉴权
- 数据按用户 ID 隔离，SQL 查询带 `WHERE user_id = ?`
- Helmet CSP 安全头
- 图片上传校验（MIME 类型、魔数、大小限制）
- Rate limiting（支持 Upstash Redis 或内存存储）
- 敏感控制台输出仅在非生产环境打印

## 📝 已知修复记录

- ✅ 修复第三步 `image` 参数接受 file_id 导致参数无效问题 → 现在仅接受 URL
- ✅ 修复 `reference_prompt is not defined` 引用错误
- ✅ 修复时区问题导致执行时间显示 480 分钟
- ✅ 修复 `multi_ready` 状态不渲染图片导致显示"未返回概念图"
- ✅ 修复前端 `process is not defined` 错误（增加 `typeof process` 检查）
- ✅ 修复重复路由挂载问题

## 📄 许可证

MIT License
