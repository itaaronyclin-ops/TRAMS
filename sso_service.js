/**
 * V-Link SSO 獨立驗證服務 (Centralized Authentication Service)
 * 作用：管理 AGCODE 綁定、處裡 QR Code 授權流程。
 */

var BINDING_SHEET_NAME = "AGCODE_Bindings";
var SESSIONS_SHEET_NAME = "QR_Sessions";

function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
  var params = e.parameter;
  var action = params.action;
  var qrToken = params.qrToken;
  var agcode = params.agcode;

  // --- [修正] 自動解析 App 傳來的 URL 封裝格式 ---
  if (params.token && params.token.indexOf('qrToken=') > -1) {
    try {
       qrToken = params.token.split('qrToken=')[1].split('&')[0];
       action = 'authorize'; 
    } catch(err) { logToSheet("Parse Error: " + err.message); }
  }

  logToSheet("REQ -> Action: " + action + " | Token: " + qrToken + " | AGCODE: " + agcode);
  
  // 1. 初始化登入 Session
  if (action === 'init_session') {
    var token = Utilities.getUuid();
    saveSession(token, 'PENDING');
    return createJsonResponse({ status: 'success', qrToken: token });
  }
  
  // 2. 輪詢 Session 狀態
  if (action === 'poll_session') {
    if (!qrToken) return createJsonResponse({ status: 'error' });
    var system = params.system || 'traffic';
    var session = getSession(qrToken.trim());
    if (!session) return createJsonResponse({ status: 'error', message: 'Token not found' });
    
    if (session.status === 'AUTHORIZED') {
      var boundUser = getBinding(session.agcode, system);
      if (!boundUser) return createJsonResponse({ status: 'unbound', agcode: session.agcode });
      return createJsonResponse({ status: 'authorized', agcode: session.agcode, bound_username: boundUser });
    }
    
    if (session.status === 'BINDING_COMPLETE') {
      return createJsonResponse({ status: 'authorized', agcode: session.agcode, bound_username: params.account });
    }
    
    return createJsonResponse({ status: 'pending' });
  }
  
  // 3. 授權 Session (手機端呼叫)
  if (action === 'authorize') {
    if (!qrToken) return createJsonResponse({ status: 'error' });
    
    var confirmAccount = params.account; 
    var system = params.system || 'traffic';
    
    if (!agcode) {
      var scriptUrl = ScriptApp.getService().getUrl();
      var html = `
        <html><body style="font-family:sans-serif; text-align:center; padding-top:40px; background:#f0f4f8;">
          <div style="display:inline-block; background:white; padding:30px; border-radius:15px; box-shadow:0 10px 25px rgba(0,0,0,0.1); width:85%; max-width:350px;">
            <h2 style="color:#2563eb;">V-Link SSO ${confirmAccount ? '二次確認' : '授權'}</h2>
            ${confirmAccount ? 
              `<p>您正在嘗試將此設備與帳號 <b>${confirmAccount}</b> 綁定</p>` : 
              `<p>請輸入您的 AGCODE 以完成授權：</p>`
            }
            <form action="${scriptUrl}" method="get">
              <input type="hidden" name="action" value="authorize">
              <input type="hidden" name="qrToken" value="${qrToken}">
              ${confirmAccount ? 
                `<input type="hidden" name="agcode" value="${params.agcode_ref || ''}">
                 <input type="hidden" name="account" value="${confirmAccount}">
                 <input type="hidden" name="system" value="${system}">
                 <button type="submit" style="width:100%; padding:15px; background:#10b981; color:white; border:none; border-radius:8px; font-size:18px; font-weight:bold; cursor:pointer;">✅ 確認綁定並登入</button>` :
                `<input type="text" name="agcode" style="width:100%; padding:15px; margin-bottom:20px; font-size:20px; border:1px solid #ccc; border-radius:8px;" required autoFocus>
                 <button type="submit" style="width:100%; padding:15px; background:#2563eb; color:white; border:none; border-radius:8px; font-size:18px; font-weight:bold; cursor:pointer;">確認授權</button>`
              }
            </form>
          </div>
        </body></html>`;
      return HtmlService.createHtmlOutput(html).setTitle("V-Link SSO 授權");
    }
    
    var statusToSet = confirmAccount ? 'BINDING_COMPLETE' : 'AUTHORIZED';
    var updated = updateSession(qrToken.trim(), statusToSet, agcode);
    
    if (updated && confirmAccount) {
      var bindingSheet = getSheet(BINDING_SHEET_NAME);
      bindingSheet.appendRow([agcode, system, confirmAccount, "****", new Date()]);
      SpreadsheetApp.flush();
    }
    
    return HtmlService.createHtmlOutput("<body style='text-align:center; padding-top:100px;'><h1>✅ 操作成功</h1><p>電腦端將自動同步...</p></body>");
  }

  // 4. 儲存綁定
  if (action === 'save_binding') {
    if (!agcode || !params.system || !params.account) return createJsonResponse({ status: 'error' });
    var sheet = getSheet(BINDING_SHEET_NAME);
    sheet.appendRow([agcode, params.system, params.account, "****", new Date()]);
    SpreadsheetApp.flush();
    return createJsonResponse({ status: 'success' });
  }

  return createJsonResponse({ status: 'error', message: 'Unknown action' });
}

// --- Helper Functions ---

var LOG_SHEET_NAME = "System_Logs";

function logToSheet(msg) {
  try { getSheet(LOG_SHEET_NAME).appendRow([new Date(), msg]); SpreadsheetApp.flush(); } catch(e) {}
}

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (name === BINDING_SHEET_NAME) {
      sheet.appendRow(["sso id", "sys name", "account", "password", "LastUpdated"]);
    } else if (name === SESSIONS_SHEET_NAME) {
      sheet.appendRow(["Token", "Status", "AGCODE", "CreatedAt"]);
    } else if (name === LOG_SHEET_NAME) {
      sheet.appendRow(["Time", "Message"]);
    }
  }
  return sheet;
}

function saveSession(token, status) {
  var sheet = getSheet(SESSIONS_SHEET_NAME);
  sheet.appendRow([token.toString(), status, "", new Date()]);
  SpreadsheetApp.flush();
}

function getSession(token) {
  if (!token) return null;
  var sheet = getSheet(SESSIONS_SHEET_NAME);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0].toString().trim() === token.toString().trim()) {
      return { token: rows[i][0], status: rows[i][1], agcode: rows[i][2] };
    }
  }
  return null;
}

function updateSession(token, status, agcode) {
  if (!token) return false;
  var sheet = getSheet(SESSIONS_SHEET_NAME);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0].toString().trim() === token.toString().trim()) {
      sheet.getRange(i + 1, 2).setValue(status);
      sheet.getRange(i + 1, 3).setValue(agcode);
      SpreadsheetApp.flush();
      return true;
    }
  }
  return false;
}

function getBinding(agcode, systemName) {
  if (!agcode) return null;
  var sheet = getSheet(BINDING_SHEET_NAME);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (rows[i][0].toString() === agcode.toString() && rows[i][1].toString() === systemName.toString()) {
      return rows[i][2]; 
    }
  }
  return null;
}
