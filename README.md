# 醫囑管理工具（iLong-termcare Medical Care Assistant）

長照家庭共享醫療大腦 · Cloudflare 全棧（Pages + Workers + D1 + KV）

## 上線網址

- **前端（家屬使用）**：https://iltc-care-tool.pages.dev
- **後端 API**：https://billowing-river-dcf6iltc-backend.service-ed8.workers.dev
- **健康檢查**：https://billowing-river-dcf6iltc-backend.service-ed8.workers.dev/health

## 架構

\`\`\`
使用者（瀏覽器 / 手機 PWA）
        ↓
Cloudflare Pages（前端，連 GitHub 自動部署）
        ↓ HTTPS API 呼叫
Cloudflare Worker（後端，連 GitHub Workers Builds 自動部署）
        ├─ LINE OAuth / Google OAuth
        ├─ JWT Session 簽發
        ├─ Gemini AI Proxy（醫囑摘要 / 語音轉文字 / 藥袋辨識）
        ├─ D1 資料庫（跨裝置同步使用者資料）
        └─ KV 命名空間（每日 AI 用量 + IP rate limit 60/min）
\`\`\`

## CI/CD 自動部署

\`\`\`
git push origin main
        ↓
   ┌────┴────┐
   ↓         ↓
前端改動   後端改動
   ↓         ↓
Cloudflare  Cloudflare
Pages 自動  Workers Builds
build       自動 build
   ↓         ↓
1-3 分鐘上線（不用手動操作）
\`\`\`

## 修改部署的流程

### 改前端
1. 編輯 `frontend/_source.html`
2. `git push`（或 GitHub 網頁直接編輯）
3. 等 1-2 分鐘 Cloudflare Pages 自動 build & deploy

### 改後端
1. 編輯 `backend/worker.js`
2. `git push`
3. 等 30-60 秒 Cloudflare Workers Builds 自動部署

## 安全強化（依《愛長照 AI 工具開發準則》）

- ✅ 移除 /api/debug 端點
- ✅ safeError() 統一錯誤處理（不洩漏堆疊訊息）
- ✅ Repository 抽象層（資料庫操作集中、未來易遷移）
- ✅ IP-based rate limit 60 req/min（透過 KV）
- ✅ CORS 嚴格白名單（ALLOWED_ORIGINS）
- ✅ JWT Bearer Token 驗證
- ✅ 所有 API Key、Secret 放 Cloudflare Secrets
- ✅ Git 自動部署（push 到 main = 上線）

詳細設定請看 [SETUP.md](./SETUP.md)
