# 部署指南（從零到自動部署，約 30 分鐘）

> 完成這份設定後，之後每次更新只要在電腦上修改 → `git push` → 1–2 分鐘自動上線。  
> 不再需要手動下載 zip、拖到 Cloudflare 的麻煩。

---

## 你需要的帳號（都免費）

- ✅ GitHub 帳號（沒有就到 https://github.com 註冊）
- ✅ Cloudflare 帳號（你已有）
- ✅ 電腦上裝 [GitHub Desktop](https://desktop.github.com/)（圖形化介面，不用打指令）

---

## Step 1：把這個 repo 推上 GitHub（10 分鐘）

### 1-1 在 GitHub 建一個空的 repo

1. 打開 https://github.com/new
2. **Repository name**：`iltc-care-tool`
3. **Public** 或 **Private** 都可以（推薦 **Private**，因為 worker.js 含商業邏輯）
4. **不要勾**「Add a README file」、「.gitignore」、「license」（我們已經有了）
5. 點「**Create repository**」
6. 出現的頁面**先不要關**，等等會用到 URL（類似 `https://github.com/你的帳號/iltc-care-tool.git`）

### 1-2 用 GitHub Desktop 把資料夾推上去

1. 把這個資料夾（解壓後的 `iltc-care-tool`）放到電腦你方便的位置（例如 `~/Documents/iltc-care-tool`）
2. 打開 **GitHub Desktop**
3. 上方選單 → **File → Add Local Repository**
4. 選你剛剛放的資料夾 → **Add Repository**
5. GitHub Desktop 會偵測到這是個尚未 init 的資料夾 → 它會問「create a repository」→ 點確認，輸入 commit message：`Initial commit` → 點「**Commit to main**」
6. 右上角點「**Publish repository**」
7. 名稱保持 `iltc-care-tool`，**取消勾選**「Keep this code private」如果你 1-1 選了 Public（兩邊要一致）
8. 點「**Publish Repository**」

✅ 完成後刷新 https://github.com/你的帳號/iltc-care-tool 應該能看到所有檔案

---

## Step 2：讓 Cloudflare Pages 從 GitHub 自動 build / 部署（10 分鐘）

### 2-1 刪掉舊的 Pages 專案（用過手動 zip 上傳的那個）

> 為了改成 GitHub 自動部署，最乾淨的做法是砍掉重建。網域 `iltc-frontends.pages.dev` 會保留。

1. Cloudflare → Workers & Pages → 點 `iltc-frontends`
2. **Settings** → 拉到最底 → **Delete project** → 輸入名稱確認

### 2-2 建立連 GitHub 的新 Pages 專案

1. Workers & Pages → **Create** → **Pages** 分頁 → **Connect to Git**
2. 第一次會跳出 GitHub 授權頁 → 同意 Cloudflare 讀你的 repo
3. 選 `iltc-care-tool` → **Begin setup**
4. 設定欄位：
   - **Project name**：`iltc-frontends`（保持原名 → 網址就還是 `iltc-frontends.pages.dev`）
   - **Production branch**：`main`
   - **Framework preset**：None
   - **Build command**：`cd frontend && npm install && npm run build`
   - **Build output directory**：`frontend/dist`
   - **Root directory（Advanced）**：留空
5. 點「**Save and Deploy**」
6. 等 2–3 分鐘第一次 build 完成

✅ 完成後 `https://iltc-frontends.pages.dev` 就是新版（內容跟之前一樣）。

---

## Step 3：讓 GitHub Actions 自動部署 Worker（10 分鐘）

### 3-1 建立 Cloudflare API Token

1. https://dash.cloudflare.com/profile/api-tokens
2. **Create Token**
3. 找到 **Edit Cloudflare Workers** 模板 → **Use template**
4. Account 和 Zone Resources 保持預設（針對你的帳號／所有 zones）
5. **Continue to summary** → **Create Token**
6. 跳出來的 token（一長串，像 `abc123def456...`）**複製起來**（只顯示這一次！）

### 3-2 拿 Cloudflare Account ID

1. Cloudflare Dashboard 任何頁面，右側欄會顯示 **Account ID**（一長串十六進位）
2. 點旁邊的複製按鈕

### 3-3 把兩個值設到 GitHub repo Secrets

1. 打開你的 GitHub repo → **Settings**（不是 Cloudflare 的 Settings）
2. 左側選單最下面 → **Secrets and variables** → **Actions**
3. **New repository secret** 兩次：
   - Name: `CLOUDFLARE_API_TOKEN`，Value: 剛才的 token
   - Name: `CLOUDFLARE_ACCOUNT_ID`，Value: 剛才的 Account ID
4. 完成

### 3-4 試跑一次

1. GitHub Desktop → 在 `backend/worker.js` 隨便加一行註解
2. 寫 commit message：`Test auto deploy` → **Commit to main** → **Push**
3. 打開 GitHub repo 頁面 → **Actions** 分頁
4. 應該看到一個正在跑的 workflow → 等綠色勾出現
5. 完成後 Worker 就自動更新了

✅ 從此你只要改 code → push → 自動上線

---

## 之後的開發流程

### 改前端
1. 在電腦編輯 `frontend/_source.html`
2. GitHub Desktop → 看到改動 → 寫 commit message → **Commit** → **Push**
3. 等 1–2 分鐘 Cloudflare Pages 自動 build 上線

### 改後端
1. 在電腦編輯 `backend/worker.js`
2. GitHub Desktop → **Commit** → **Push**
3. 等 30–60 秒 GitHub Actions 自動部署

### 看部署狀態
- 前端：Cloudflare Pages → Deployments
- 後端：GitHub repo → Actions

---

## 重要：Worker 的 Secrets 和 Bindings 不會自動同步

**API token / channel secret / D1 / KV 這些設定，仍然要在 Cloudflare Dashboard 手動設定一次：**

### Secrets（Worker → Settings → Variables and Secrets）
- `JWT_SECRET`
- `LINE_CHANNEL_ID`
- `LINE_CHANNEL_SECRET`
- `LINE_REDIRECT_URI`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GEMINI_API_KEY`
- `ALLOWED_ORIGINS`
- `FRONTEND_URL`

### Bindings（Worker → Bindings）
- `DB` → D1 database `iltc-data`
- `KV` → KV namespace（建議叫 `iltc-kv`）

> 這些只要設定一次，之後 wrangler 部署時不會被覆蓋。
> 如果想完全用 code 管理，可以在 `wrangler.toml` 加上 `database_id` 和 `kv_namespaces id`，但建議手動 UI 設置就好。

---

## 故障排除

**Q: Pages build 失敗怎麼辦？**
A: 點 Cloudflare Pages → Deployments → 失敗那筆 → View build log。看 `npm install` 或 `npm run build` 哪一行出錯。最常見：缺檔案、tailwind.config.js 有錯字、_source.html 有 JSX 語法錯誤。

**Q: Worker 部署成功但 Secrets 不見了？**
A: 不會。Wrangler 部署只覆蓋 code，不動 Secrets / Bindings。

**Q: 我可以用 `dev` 分支做測試嗎？**
A: 可以。Cloudflare Pages 會自動為非 main 分支建立 preview URL（每個分支一個獨立預覽網址，不影響正式版）。

**Q: 不想公開原始碼怎麼辦？**
A: GitHub repo 設 Private 即可。Cloudflare 連接時還是可以讀（已授權）。
