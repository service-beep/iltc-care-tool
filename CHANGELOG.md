# CHANGELOG

## v3.4-sharing — 2026-05-09

### 🆕 新功能

#### Feature 1：看診紀錄一鍵 AI 分享 LINE
- ConsultationView 的「分享到 LINE」按鈕改為**一鍵 AI 整理 + 分享**
- 點擊後 Gemini 自動把醫師原話整理成「家屬看得懂的版本」
- 內容自動分段：看診資訊 / 病況說明 / 醫師處方 / 家屬注意事項 / 下次回診
- 不再有大量 emoji，純文字 + 【】分區
- AI 失敗時 fallback 到原始資料純文字

#### Feature 2：多照顧者共享被照顧者資料
- 主照顧者可在 PatientEditor 點「邀請其他照顧者」→ 取得 6 碼邀請碼
- 邀請碼**永久有效**（直到「重新產生」）
- 一鍵複製、一鍵 LINE 分享給家人
- 其他照顧者用各自 LINE/Google 登入後 → 輸入碼即可加入
- 雙向編輯：所有人都能新增/編輯（最後寫入贏）
- **每位被照顧者最多 5 位照顧者**
- 患者列表用紫色頭像 + 「由 XX 分享」標記區分來源
- 主照顧者可在邀請對話框看到全部加入名單、可移除某人或重新產生碼
- 被分享者可主動「退出此被照顧者」

### 🛠️ 後端改動（worker.js）

- 版本號 → `v3.4-sharing-20260509`
- 新增 D1 資料表（自動建立）：
  - `share_invites` — 邀請碼
  - `patient_shares` — 共享關係
- 新增 5 個 API endpoints：
  - `POST /api/share/invite/create`
  - `POST /api/share/invite/regenerate`
  - `POST /api/share/redeem`
  - `GET /api/share/list?patientId=xxx`
  - `DELETE /api/share/remove`
- 改寫 `GET /api/data`：合併本人資料 + 被分享給我的 patient
- 改寫 `PUT /api/data`：寫入時自動把「被分享的 patient」路由寫回 owner 的 user_data
- 新增 helper：`genUniqueShareCode`、`SHARE_PATIENT_COLLECTION_KEYS`、`MAX_CAREGIVERS_PER_PATIENT`
- Repository 層擴充：邀請碼、共享關係的 CRUD

### 🎨 前端改動（_source.html）

- 版本號 → `v3.4 build 20260509 · 多照顧者共享`
- 新增 React 元件：
  - `InviteShareModal`（邀請碼對話框）
  - `RedeemCodeModal`（輸入邀請碼對話框）
- 改寫 `PatientEditor`：根據是「自己擁有」或「被分享」顯示不同按鈕
- 改寫 `PatientSwitcher`：列表項加來源標籤、底部加「輸入邀請碼」按鈕
- 改寫 `MainApp`：抽出 `reloadFromCloud` 讓加入新共享後可刷新資料
- 歡迎頁加「輸入邀請碼加入照顧」連結
- 新增 21 條翻譯字串（4 種語言）

### ⚙️ 設定改動（wrangler.toml）

- 新增 D1 binding 宣告（`binding = "DB"`, `database_name = "iltc-data"`）
- 加入 KV binding 模板（commented，需要填 ID 才啟用）
- 加入詳細註解說明：「Workers Builds 部署會清掉 UI 手動加的 bindings，必須在 toml 宣告」

### ⚠️ 重要部署注意事項

**首次部署 v3.4 後必做：**

1. 後端 Worker → Settings → **Bindings** → 確認 D1 `DB` binding 還在
2. 如果不見了 → 手動加回（D1 database = `iltc-data`，variable name = `DB`）
3. **拿到 D1 Database ID** → 填到 `wrangler.toml` 的 `database_id = "TODO_..."`
4. 再 commit & push 一次，從此 Workers Builds 不會再清掉 binding

**KV namespace（可選）**：
- 沒建過 → 沒影響（rate limit 自動跳過）
- 想啟用 → Cloudflare → Storage & Databases → KV → Create namespace → 拿到 ID → 填到 wrangler.toml 並把那段 # 註解拿掉

### 🐛 已知限制

- 多人同時編輯同一筆資料時，採「最後寫入贏」（沒有衝突偵測）
- 主照顧者刪除被分享患者後，被分享者那邊可能短暫看到不一致（直到下次同步）
- 照顧者顯示名稱抓 OAuth 註冊名，目前無法自己改

---

## v3.3-hardened — 2026-05-02

### 安全強化（依《愛長照 AI 工具開發準則》）
- 移除 `/api/debug` 端點（避免暴露內部資訊）
- 新增 `safeError()` 統一錯誤處理（不洩漏堆疊訊息，回 request_id 方便對 log）
- 新增 Repository 抽象層（資料庫操作集中、未來易遷移）
- 新增 IP-based rate limit 60 req/min（透過 KV）
- CORS 嚴格白名單（ALLOWED_ORIGINS）

### 部署管線
- 設好 GitHub 自動部署（前端 Pages + 後端 Workers Builds）

---

## v3.0+ — 2026-04
- LINE / Google OAuth 上線
- D1 跨裝置雲端同步
- Bearer Token 驗證機制
- Gemini 2.5 Flash AI 整合（醫囑摘要、語音辨識、藥袋拍照）
- 多語介面（繁中 / English / Indonesia / Vietnamese）
