# 部署現況與維運指南

> 系統已於 2026-05-08 完成 GitHub 自動部署設定。本文件記錄目前架構與如何維護。

---

## 目前已上線的服務

| 服務 | 名稱 | 網址 | 部署方式 |
|------|------|------|---------|
| 前端 | iltc-care-tool（Pages） | https://iltc-care-tool.pages.dev | GitHub → Cloudflare Pages 自動 |
| 後端 | billowing-river-dcf6iltc-backend（Worker） | https://billowing-river-dcf6iltc-backend.service-ed8.workers.dev | GitHub → Workers Builds 自動 |
| 資料庫 | iltc-data（D1） | （內部） | 手動建立，binding 名 `DB` |
| 快取 | iltc-kv（KV） | （內部） | 手動建立，binding 名 `KV` |

---

## CI/CD 設定總覽

### 前端（Cloudflare Pages）

- **Pages 專案名**：`iltc-care-tool`
- **Git repository**：`service-beep/iltc-care-tool`
- **Production branch**：`main`
- **Build command**：`cd frontend && npm install && npm run build`
- **Build output directory**：`frontend/dist`
- **Root directory**：留空（即 repo 根目錄）

### 後端（Cloudflare Workers Builds）

- **Worker 名**：`billowing-river-dcf6iltc-backend`
- **Git repository**：`service-beep/iltc-care-tool`
- **Production branch**：`main`
- **Build command**：留空
- **Deploy command**：`npx wrangler deploy`
- **Path（Root directory）**：`/backend`

---

## 修改 code 的標準流程

### 改前端

1. 編輯 GitHub 上的 `frontend/_source.html`（或本機改完 push）
2. Commit 到 `main` 分支
3. Cloudflare Pages 偵測到變動 → 自動 build & deploy
4. 1-3 分鐘後 https://iltc-care-tool.pages.dev 顯示新版

### 改後端

1. 編輯 GitHub 上的 `backend/worker.js`（或 `backend/wrangler.toml`）
2. Commit 到 `main` 分支
3. Cloudflare Workers Builds 偵測到變動 → 自動 `npx wrangler deploy`
4. 30-60 秒後 Worker 更新

### 確認部署成功

- **前端**：開新分頁進 https://iltc-care-tool.pages.dev，看頁尾版本號或硬重新整理（Cmd+Shift+R）
- **後端**：訪問 https://billowing-river-dcf6iltc-backend.service-ed8.workers.dev/health 看 JSON 回應

---

## Worker 必要 Secrets 與 Bindings

> 這些設定**只放在 Cloudflare Dashboard**，不在 GitHub 上（為了安全）。Wrangler 部署時不會覆蓋。

### Secrets（Worker → Settings → Variables and Secrets）

| 變數名 | 說明 |
|-------|------|
| `JWT_SECRET` | 簽 JWT 用，至少 32 字元亂碼 |
| `LINE_CHANNEL_ID` | LINE Login Channel ID |
| `LINE_CHANNEL_SECRET` | LINE Login Channel Secret |
| `LINE_REDIRECT_URI` | LINE callback 網址（後端 URL/api/auth/line/callback） |
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Client Secret |
| `GOOGLE_REDIRECT_URI` | Google callback 網址（後端 URL/api/auth/google/callback） |
| `GEMINI_API_KEY` | Google AI Studio API Key |
| `ALLOWED_ORIGINS` | 允許的前端網址（CORS），逗號分隔 |
| `FRONTEND_URL` | OAuth 完成後跳回的前端網址 |

### Bindings（Worker → Settings → Bindings）

| 類型 | 名稱（變數） | 對應資源 |
|------|------|---------|
| D1 Database | `DB` | iltc-data |
| KV Namespace | `KV` | iltc-kv |

---

## 故障排除

### Q: 前端推上去了，但網頁還是舊版

- 強制重新整理瀏覽器（Cmd+Shift+R / Ctrl+Shift+R）
- 確認 Cloudflare Pages → Deployments 有最新 build
- 看頁尾版本號是不是新的

### Q: Worker build 失敗

- 看 Cloudflare → Worker → Settings → Build → Build history → View build → Logs
- 最常見：`wrangler.toml` 的 `name` 跟 Worker 實際名字不一致 → 需要改 wrangler.toml
- 或：Path 設成 `/` 而 worker.js 在 `/backend` → 改 Path 為 `/backend`

### Q: 登入後 Safari 顯示「找不到伺服器」

- FRONTEND_URL Secret 指向不存在的網址
- 解法：到 Worker → Variables and Secrets → 改 `FRONTEND_URL` 為當前真正的前端網址

### Q: 跨裝置同步不動 / D1 寫入失敗

- 看 `ALLOWED_ORIGINS` 是否包含當前前端網址
- 看瀏覽器 Console 有沒有 CORS 錯誤
- 看 Worker logs（Cloudflare → Worker → Logs Live tail）

### Q: AI 額度爆了（429 / quota_exceeded）

- 看 KV → 該使用者今天是否超過 100 次（程式內限制）
- 或：Gemini API Key 在 Google Cloud 該專案的免費 quota 用完
- 解法：到 Google AI Studio 換新 Key 或開計費

---

## 後續維運待辦

### 已完成 ✅

- [x] GitHub 自動部署（前端 + 後端）
- [x] 安全強化（依《愛長照 AI 工具開發準則》）
- [x] 跨裝置雲端同步（D1）
- [x] LINE / Google OAuth
- [x] Gemini AI 整合
- [x] 多語介面

### 規劃中 🔜

- [ ] 開啟所有後台 2FA（Cloudflare、GitHub、LINE、Google）
- [ ] 撤銷舊 token 重發（之前對話中曾分享過）
- [ ] 刪除多餘的空 Worker
- [ ] 設定 dev 分支 + Preview 環境
- [ ] 綁自訂網域（`medcare.ilong-termcare.com`）
- [ ] D1 定期備份
- [ ] 隱私權政策頁面
- [ ] 用戶資料刪除功能

---

## 重要連結

- **Notion 文件**：https://www.notion.so/ilong-termcare/07748fa795fa4b0fa188785522115ef9
- **GitHub Repo**：https://github.com/service-beep/iltc-care-tool
- **Cloudflare Dashboard**：https://dash.cloudflare.com
- **LINE Developers**：https://developers.line.biz/console/
- **Google Cloud Console**：https://console.cloud.google.com
- **Google AI Studio**：https://aistudio.google.com
