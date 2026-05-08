# 醫囑管理工具（iLong-termcare Medical Care Assistant）

長照家庭共享醫療大腦 · Cloudflare 全棧（Pages + Workers + D1 + KV）

## 架構

```
使用者（瀏覽器 / 手機 PWA）
        ↓
Cloudflare Pages（前端）
        ↓ HTTPS API 呼叫
Cloudflare Worker（後端）
        ├─ LINE OAuth / Google OAuth
        ├─ JWT Session 簽發
        ├─ Gemini AI Proxy（醫囑摘要 / 語音轉文字 / 藥袋辨識）
        ├─ D1 資料庫（跨裝置同步使用者資料）
        └─ KV 命名空間（每日 AI 用量 + IP rate limit）
```

## 開發指引

請看 [SETUP.md](./SETUP.md) 了解：
- 如何把這個 repo 推上 GitHub
- 如何讓 Cloudflare Pages 從 GitHub 自動 build / 部署
- 如何讓 GitHub Actions 自動部署 Worker
- 之後每次更新只要 git push，1–2 分鐘自動上線

## 資料夾結構

```
iltc-care-tool/
├── frontend/                前端（Cloudflare Pages）
│   ├── _source.html        主要原始碼（你會改的檔案）
│   ├── build.mjs           編譯腳本（Pages 自動執行）
│   ├── libs/               React / Chart.js 等內嵌函式庫
│   ├── package.json        npm 設定
│   └── tailwind.config.js  Tailwind 設定
│
├── backend/                後端（Cloudflare Worker）
│   ├── worker.js           Worker 主程式
│   └── wrangler.toml       部署設定（含 D1 / KV 綁定）
│
└── .github/workflows/
    └── deploy-worker.yml   推 Worker 上線的 GitHub Actions
```
