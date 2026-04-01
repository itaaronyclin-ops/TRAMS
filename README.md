# Traffic Accident Case Management System

這是一個基於 Web + Google Apps Script 的交通事故案件管理系統。

## 功能特色
- **案件管理**：新增、編輯、查詢交通事故案件。
- **自動排程**：自動提醒行程 (4小時、1小時、30分鐘前)。
- **待辦事項**：自訂提醒時間，Telegram 自動推播。
- **報表產生**：自動計算求償金額與肇責比例。
- **雲端同步**：資料儲存於 Google Sheets。

## 部署方式 (GitHub + Vercel)

1. **上傳至 GitHub**
   將此資料夾內容推送到您的 GitHub Repository。

2. **部署至 Vercel**
   - 連結您的 GitHub 帳號。
   - 匯入此專案。
   - Vercel 會自動讀取 `vercel.json` 進行部署。

3. **Google Apps Script設定**
   - 將 `server/Code.gs` 的內容複製到您的 Google Apps Script 專案。
   - 部署為 Web App (權限：Anyone)。
   - 將取得的 Web App URL 更新至 `scripts/app.js` (或是透過介面設定)。

## 目錄結構
- `index.html`: 主頁面
- `scripts/`: 前端邏輯 (app.js, sound.js)
- `server/`: 後端 Google Apps Script (Code.gs)
- `vercel.json`: Vercel 部署排定
