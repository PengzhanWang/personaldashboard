# Personal LifeOS Dashboard

个人 Bento 画布与项目工作台（纯 \$0 架构：Cloudflare Workers + KV + Google Sheets / Drive）。

- **线上地址**：https://lifeos-dashboard.wangpz.workers.dev
- **代码仓库**：https://github.com/PengzhanWang/personaldashboard
- **视觉风格**：Dunkirk Sea-Mist 配色 + Nolan / Gotham（Montserrat）宽字距编辑排版

---

## 本地开发快速上手（Windows / macOS 通用）

### 1. 环境准备
- [Node.js 22+](https://nodejs.org/)（自带 `npm`）
- [Git](https://git-scm.com/)

### 2. 拉取代码并安装依赖
```bash
git clone https://github.com/PengzhanWang/personaldashboard.git
cd personaldashboard
npm install
```

### 3. 本地预览（无需配置 Google Sheets，默认走本地 Mock 数据）
复制环境变量模板：

- **Windows (PowerShell)**：
  ```powershell
  Copy-Item .dev.vars.example .dev.vars
  ```
- **macOS / Linux**：
  ```bash
  cp .dev.vars.example .dev.vars
  ```

然后启动本地服务（同时运行前端与 Worker API）：
```bash
npm run preview
```
打开终端输出的 `http://localhost:8787`，用 `.dev.vars` 里填的密码登录即可调试。本地默认使用 Wrangler 模拟的 KV（MockBackend），不会影响你线上 Google Sheets 的真实数据。

> 仅调试前端样式也可以用 `npm run dev`（Vite 热更新）。

### 4. 类型检查与构建
```bash
npm run typecheck
npm run build
```

### 5. 部署到线上 Cloudflare Workers
第一次在本机部署时先登录一次 Cloudflare（之后自动记住登录态，无需手动传 Token）：
```bash
npx wrangler login
```
以后每次改完代码直接部署：
```bash
npm run deploy
```

> 提醒：如果之前在云端对话里提供过临时 Cloudflare API Token，建议到 Cloudflare 控制台 → API Tokens 中将其删除。

### 6. 在本地 Antigravity / AI IDE 中继续开发
把 `personaldashboard` 文件夹在本地打开后，直接对 Agent 说：
> 请先阅读 `AGENTS.md` 和 `docs/PROJECT_WORKSPACE_SPEC.md`，然后继续第 3 阶段开发。

---

## 文档索引
- `AGENTS.md`：项目全貌、设计约束、当前进度与待办（给本地 AI Agent 的交接文档）
- `docs/PROJECT_WORKSPACE_SPEC.md`：全屏项目工作台设计共识与 3 阶段计划
- `docs/ARCHITECTURE.md`：系统架构说明
- `docs/CANVAS_DESIGN.md`：Bento 画布交互设计
- `docs/SETUP.md`：Google Sheets / Apps Script / Cloudflare 初次部署指南
