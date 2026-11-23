# Phase 1 MVP 部署与配置指南（零费用）

本指南带你用 **约 15 分钟**把 LifeOS Dashboard 跑通：Google Sheets 存数据 + Cloudflare Workers（免费）托管前端和接口，**无需绑卡、无需买域名**。

---

## 一、本地先体验（不配 Google 也能跑）

```bash
cp .dev.vars.example .dev.vars
npm run preview
```

打开终端里输出的地址（默认 `http://127.0.0.1:8787`），用 `.dev.vars` 里的 `APP_PASSWORD` 登录。
此时 `GAS_URL` 为空，Worker 会自动使用本地 KV Mock 后端，方便你先体验所有功能。

---

## 二、配置 Google Sheets + Apps Script（数据底座）

1. 在 Google Drive 新建一个空白表格，命名为 **`LifeOS-Core`**。
2. 菜单栏点 **扩展程序 → Apps Script**。
3. 把仓库里 `gas/Code.gs` 的全部内容粘贴到编辑器里，保存（Ctrl+S）。
4. 顶部函数下拉选择 **`setupSheets`**，点 **运行**（首次会提示授权，点“高级 → 转至未命名项目”允许即可）。
   - 运行完回到表格，应该能看到 `Projects`、`Tasks`、`_Meta`、`_Log` 四个工作表，表头已加粗并冻结。
5. 生成一个随机密钥（例如在终端运行 `openssl rand -hex 32`），记下来，后面 Cloudflare 也要填同一个值。
6. 在 Apps Script 左侧点 **项目设置（齿轮）→ 脚本属性 → 添加脚本属性**：
   - 属性：`HMAC_SECRET`
   - 值：刚才生成的 64 位随机字符串
7. 右上角点 **部署 → 新建部署**：
   - 类型选 **Web 应用**
   - 执行身份：**我**
   - 谁可以访问：**任何人**（别担心，没有 `HMAC_SECRET` 签名任何请求都会被拒）
   - 点部署，复制生成的 **`https://script.google.com/macros/s/.../exec`** 链接。

> ⚠️ 以后如果修改了 `gas/Code.gs`，点 **部署 → 管理部署 → 编辑 → 版本选“新版本”**，这样 `/exec` 链接不会变。

---

## 三、部署到 Cloudflare Workers（免费、无需绑卡）

1. 登录 Cloudflare：
   ```bash
   npx wrangler login
   ```
2. 创建一个 KV 命名空间（用于边缘快照缓存和登录限流）：
   ```bash
   npx wrangler kv namespace create KV
   ```
   把输出里的 `id` 填进 `wrangler.jsonc` 中的 `REPLACE_WITH_YOUR_KV_NAMESPACE_ID`。
3. 配置 4 个服务端密钥（不会进仓库）：
   ```bash
   npx wrangler secret put APP_PASSWORD      # 你自己设的登录密码
   npx wrangler secret put SESSION_SECRET    # 再运行一次 openssl rand -hex 32 生成
   npx wrangler secret put GAS_URL           # 上一步复制的 /exec 链接
   npx wrangler secret put GAS_HMAC_SECRET   # 上一步填进 Apps Script 的 HMAC_SECRET
   ```
4. 构建并部署：
   ```bash
   npm run deploy
   ```
5. 部署成功后会输出 `https://lifeos-dashboard.<你的子域>.workers.dev`，用浏览器打开即可。
   - **手机端**：在 Safari / Chrome 里点“添加到主屏幕”，即可当 App 使用。
   - **公司电脑**：先用这个地址确认公司网络没有屏蔽 `workers.dev`；登录时选 **公司电脑**，敏感项目不会下发且 12 小时自动过期。
