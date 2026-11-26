# AGENTS.md — LifeOS Dashboard 项目交接上下文

本文件用于帮助本地 AI Agent 快速接手项目，避免丢失前期设计共识与约束。

## 1. 项目概览
- **定位**：单用户个人 LifeOS 看板（Bento 自由拼图画布 + 点击卡片展开的全屏项目工作台）。
- **技术栈**：React 19 + TypeScript + Tailwind CSS v4 + Vite 8 + PWA；后端为 Cloudflare Workers（Static Assets + KV）+ Google Apps Script（读写 Google Sheets 与 Google Drive）。
- **线上地址**：`https://lifeos-dashboard.wangpz.workers.dev`
- **仓库**：`PengzhanWang/personaldashboard`（默认分支 `main`）
- **当前运行平台**：用户目前在 Windows 上本地开发，几个月后会换到 macOS。

## 2. 硬性约束
1. **严格 \$0 成本**：不引入收费服务或需要绑卡的功能（如 Cloudflare Access）。
2. **无外部 CDN**：生产环境 CSP 为 `default-src 'self'`，字体使用本地打包的 `@fontsource/montserrat`。
3. **数据向后兼容**：
   - `shared/schema.ts` 与 `gas/Code.gs` 中的 `TABLE_COLUMNS` 必须手动保持完全一致。
   - `CardFinish` 的 5 个 ID（`default | warm | sage | mist | ink`）保持不变。
   - 修改 `gas/Code.gs` 后，用户需要在 Google Sheets → 扩展程序 → Apps 脚本 → **部署 → 管理部署 → 编辑 → 版本选「新版本」→ 部署**（以保持 `/exec` URL 不变）。
4. **隐私规则**：只针对账号密码类卡片保留「默认隐藏内容（`layout_json.masked`）」功能；后续新功能不再考虑「公司模式」。
5. **沟通语言**：默认使用中文回复，保持简洁。

## 3. 视觉规范（Dunkirk Sea-Mist + Nolan/Gotham）
- 颜色 Token 定义在 `src/index.css`：
  - `--background: #ECF0F4`（海雾浅灰蓝）
  - `--foreground: #0F1E30`（深海墨）
  - `--muted-foreground: #5C6F84`
  - `--accent: #D94E28`（救生橙）
  - `--accent-2: #25548A`（北海蓝）
  - 圆角 `3px`，细边框 `1px solid var(--hairline)`。
- 字体工具类：`.nolan-display`（大写 0.22em 字距）、`.nolan-label`（0.14em）、`.nolan-title`（0.04em）。

## 4. 当前进度（截至最近提交）
- [x] Bento 自由拖拽 / 缩放 / S-M-W-L 尺寸预设 / 多画布 / 搜索(`Ctrl+K`) / 遮挡(`Alt+B`) / WebP 图片上传
- [x] Dunkirk Sea-Mist + Nolan/Gotham 视觉重设计
- [x] 账号密码卡片隐藏遮罩（`layout_json.masked`，30 秒及切页自动重隐藏，单行 `COPY` 只复制冒号后的值）
- [x] **项目工作台 · 第 1 阶段**：`Items` 表（`schema.ts` / `gas/Code.gs` / `worker` / `store.tsx`）+ 全屏工作台 `src/components/ProjectWorkspace.tsx`（4 套列模板、列重命名/增删/排序、看板拖拽、条目 CRUD、右侧项目笔记 ⇄ 条目详情栏）
- [x] **项目工作台 · 第 2 阶段**：Worker `POST /api/unfurl` 网页标题抓取 + `src/components/BatchAddModal.tsx`（批量粘贴链接并抓标题预览、拖入本地文件并记住按项目的本地文件夹前缀、单条添加）+ 工作台全局文件拖拽 + 列底部快加静默抓标题

## 5. 下一步待办（第 3 阶段）
详细设计见 `docs/PROJECT_WORKSPACE_SPEC.md`：
1. **画布卡片封面（`src/components/BentoCanvas.tsx`）**：
   - 当卡片存在 `Items` 条目时，画布上改为展示「项目封面」：进度条（完成数/总数）、各资源类型数量胶囊、第一列的下一条待办/待学预览；点击卡片直接进入全屏工作台。
   - 无条目的卡片保持原样展示文字/清单/图片。
2. **手机端勾选清单（`src/components/MobileChecklist.tsx` 或集成在 `ProjectWorkspace.tsx`）**：
   - 窄屏（`< 640px`）或手机预览模式下，全屏工作台不显示横向看板，改为按列分组的竖向清单。
   - 每条左侧有勾选框：勾选即移入最后一列（完成列）并把原列记入 `prev_column_id`；取消勾选自动回到 `prev_column_id`（无记录则回第一列）。
   - 已完成组默认折叠；点击标题直接打开链接；支持顶部粘贴链接快速添加；不支持拖拽。
3. **后续可选方向**：如果用户之后希望进一步将运行数据也迁到本地（如本地 Node 服务 + SQLite，点击本地文件直接用系统默认程序打开），数据结构已按本地优先设计，可直接复用 `shared/schema.ts` 和全部前端组件。

## 6. 常用命令
```bash
npm run typecheck   # TypeScript 检查
npm run build       # 构建前端 dist/
npm run preview     # 本地构建并启动 wrangler dev（MockBackend）
npm run deploy      # 构建并部署到 Cloudflare Workers
```
