# 將專案部署至 GitHub Pages 指南

GitHub Pages 是一個完全免費的靜態網頁託管服務，非常適合您的交通助手前端。

## 第一步：將專案上傳至 GitHub (拖曳法)

如果您已經按照先前的建議建立了 GitHub 儲存庫：

1. 開啟您的 GitHub 儲存庫頁面。
2. 點擊 **"Add file" > "Upload files"**。
3. 將桌面 **`Traffic_GitHub_Files` 資料夾內的所有內容** 拖進網頁上傳。
4. 在下方 "Commit changes" 輸入描述並點擊提交。

## 第二步：開啟 GitHub Pages 功能

1. 在 GitHub 儲存庫頁面上方，點擊 **"Settings"**。
2. 在左側選單中找到 **"Code and automation" > "Pages"**。
3. 在 **"Build and deployment" > "Branch"** 下方：
   - 選擇 **`main`** 分支。
   - 資料夾選擇 **`/(root)`**。
   - 點擊 **"Save"**。

## 第三步：取得您的網址

1. 儲存後，頁面上方會出現一個黃色或綠色的進度條。
2. 大約 1-2 分鐘後，刷新頁面，您會看到：**"Your site is live at https://您的帳號.github.io/專案名稱/"**。
3. 點擊該網址即可開啟您的助手。

---

## ⚠️ 重要提醒：修正資源路徑

GitHub Pages 的網址通常帶有專案路徑（例如 `/traffic-accident-management/`）。如果網頁開啟後樣式或指令沒出來，請檢查：

1. **index.html**：
   - 確保引用路徑是相對路徑，例如 `src="scripts/app.js"` 而不是 `/scripts/app.js`。
2. **Settings**：
   - 部署完成後，請務必開啟網頁並測試登入，確保與 Google Apps Script 的連線依然正常。

如果您在開啟 Pages 功能時遇到問題，隨時告訴我！
