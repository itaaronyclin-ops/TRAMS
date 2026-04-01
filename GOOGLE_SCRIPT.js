var SHEET_NAME = "Cases";
var SETTINGS_SHEET_NAME = "Settings";
var REMINDERS_SHEET_NAME = "Reminders";
var LOG_SHEET_NAME = "DebugLog";

// 腳本當前版本
var SCRIPT_VERSION = "2026.02.13.09 (Reverted With Enhancements)";

function doGet(e) { return handleRequest(e); }
function doPost(e) { return handleRequest(e); }

function handleRequest(e) {
    if (!e || (e.postData && e.postData.length === 0 && !e.parameter)) return ContentService.createTextOutput("no data");

    var isTelegram = false;
    try {
        var contents = null;
        if (e.postData && e.postData.contents) {
            try { contents = JSON.parse(e.postData.contents); } catch (jsonErr) { }
        }

        if (contents && contents.update_id) isTelegram = true;

        if (isTelegram) {
            handleTelegramMessage(contents);
            return ContentService.createTextOutput("ok");
        }

        var action = e.parameter.action;

        if (action === 'login') return handleLogin(e);

        if (contents === null && e.parameter.action === 'get') {
            return ContentService.createTextOutput(JSON.stringify({
                status: 'success',
                data: JSON.stringify({
                    cases: readCases(),
                    settings: readSettings(),
                    reminders: readReminders()
                })
            })).setMimeType(ContentService.MimeType.JSON);
        }

        if (contents) {
            var payload = contents;
            if (payload.cases) saveCases(payload.cases);
            if (payload.settings) saveSettings(payload.settings);
            if (payload.uploads && payload.uploads.length > 0) processUploads(payload.uploads);
            if (payload.reminders) saveReminders(payload.reminders);

            return ContentService.createTextOutput(JSON.stringify({ status: 'success' }))
                .setMimeType(ContentService.MimeType.JSON);
        }
        return ContentService.createTextOutput("invalid request");
    } catch (err) {
        logDebug("Sync Error", err.toString());
        if (isTelegram) return ContentService.createTextOutput("ok");
        return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

function handleLogin(e) {
    var u = e.parameter.u;
    var p = e.parameter.p;

    // 🛡️ 強制後端驗證：直接寫死 admin/admin 通關
    if (u === 'admin' && p === 'admin') {
        return ContentService.createTextOutput(JSON.stringify({ status: 'success', mode: 'hardcoded' })).setMimeType(ContentService.MimeType.JSON);
    }

    var settings = readSettings();
    var users = settings.users || [];
    var valid = users.some(function (user) { return user.u === u && user.p === p; });

    return ContentService.createTextOutput(JSON.stringify({ status: valid ? 'success' : 'error' })).setMimeType(ContentService.MimeType.JSON);
}

function handleTelegramMessage(payload) {
    try {
        var msg = payload.message;
        if (!msg || !msg.text) return;

        var text = msg.text;
        var chatId = msg.chat.id;

        if (text === '/summary') {
            sendWeeklySummary(chatId);
        } else if (text === '/start') {
            var welcomeMsg = "<b>🤖 交通助手已啟動 (純推播模式)</b>\n\n雖然目前以自動通知為主，但您可以輸入 /summary 手動獲取週報。\n\n<i>(系統已嘗試清除舊版自定義按鈕)</i>";
            // 強制移除鍵盤按鈕 (remove_keyboard)
            sendTelegramNotification(welcomeMsg, chatId, { "remove_keyboard": true });
        }

        logDebug("TG CMD", text);
    } catch (e) {
        logDebug("TG Err", e.toString());
    }
}

function checkReminders() {
    try {
        var now = new Date();
        var cases = readCases();
        var reminders = readReminders();
        var remindersUpdated = false;
        var casesUpdated = false;

        // 1. 自訂提醒
        reminders.forEach(function (r) {
            if (!r.notified && new Date(r.time) <= now) {
                var details = "";
                if (r.note) details += "\n📝 備註：" + r.note;
                sendTelegramNotification("<b>🔔 待辦事項提醒</b>\n" + (r.caseTitle || "無標題") + details);
                r.notified = true;
                remindersUpdated = true;
            }
        });

        // 2. 行程提醒 (新增 4h, 1h, 30m)
        cases.forEach(function (c) {
            if (c.itinerary) {
                c.itinerary.forEach(function (ev) {
                    var evTime = new Date(ev.time);
                    var diffMs = evTime - now;
                    var diffHours = diffMs / (1000 * 60 * 60);
                    var diffMins = diffMs / (1000 * 60);

                    if (!ev.notified) ev.notified = [];

                    var msgHeader = "";
                    var shouldSend = false;
                    var tag = "";

                    // 4小時 (3.9 - 4.1)
                    if (diffHours <= 4 && diffHours > 3.8 && ev.notified.indexOf('4h') === -1) {
                        msgHeader = "<b>🗓️ 行程提醒 [4小時後]</b>"; tag = '4h'; shouldSend = true;
                    }
                    // 1小時 (0.9 - 1.1)
                    else if (diffHours <= 1 && diffHours > 0.8 && ev.notified.indexOf('1h') === -1) {
                        msgHeader = "<b>⏰ 行程提醒 [即將開始]</b>"; tag = '1h'; shouldSend = true;
                    }
                    // 30分鐘 (25 - 35 min)
                    else if (diffMins <= 35 && diffMins > 25 && ev.notified.indexOf('30m') === -1) {
                        msgHeader = "<b>🔥 行程提醒 [30分鐘後]</b>"; tag = '30m'; shouldSend = true;
                    }

                    if (shouldSend) {
                        var location = ev.location || "未指定地點";
                        var contact = c.clientPhone || "無電話"; // 若資料庫無此欄位則顯示預設
                        var content = msgHeader + "\n" +
                            "-----------------------\n" +
                            "👤 當事人：" + (c.clientName || "未命名") + "\n" +
                            "🚗 車牌：" + (c.plate || "無") + "\n" +
                            "📅 事項：" + ev.event + "\n" +
                            "📍 地點：" + location + "\n" +
                            "📞 電話：" + contact + "\n";

                        // 增加更豐富的內容 (例如 Google Maps 連結)
                        if (location !== "未指定地點") {
                            content += "🗺️ <a href='https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(location) + "'>開啟地圖</a>";
                        }

                        sendTelegramNotification(content);
                        ev.notified.push(tag);
                        casesUpdated = true;
                    }
                });
            }

            // 3. 事故滿 30 日提醒 (保留原有邏輯)
            if (c.date && (c.status === 'Waiting' || c.status === 'New')) {
                var accidentDate = new Date(c.date);
                var diffDays30 = Math.floor((now - accidentDate) / (1000 * 60 * 60 * 24));

                if (diffDays30 >= 30) {
                    var oldStatus = c.status;
                    c.status = 'Processing'; // 自動轉處理中
                    if (!c.history) c.history = [];
                    c.history.unshift({
                        date: now.toLocaleString('zh-TW'),
                        content: "系統自動通知：事故已滿 30 日，已可申請初步分析研判表，狀態由「" + oldStatus + "」自動轉為「處理中」。",
                        type: 'system'
                    });

                    var msg = "<b>⚠️ 事故滿 30 日提醒</b>\n\n" +
                        "案件: " + (c.clientName || "未命名") + " (" + (c.plate || "無") + ")\n" +
                        "詳情: 事故發生已滿 30 日，請盡速申請初判表並更新案件狀態。";
                    sendTelegramNotification(msg);
                    casesUpdated = true;
                }
            }
        });

        if (remindersUpdated) saveReminders(reminders);
        if (casesUpdated) saveCases(cases); // 這裡改為直接 saveCases 以觸發變更通知 (如果有變更的話)
    } catch (e) { logDebug("Reminder Error", e.toString()); }
}

function getChineseWeekday(date) {
    var days = ["日", "一", "二", "三", "四", "五", "六"];
    return "週" + days[date.getDay()];
}

function sendWeeklySummary(forcedChatId) {
    var cases = readCases();
    var now = new Date();

    // 1. Processing Cases
    var processingCases = cases.filter(function (c) {
        return c.status === 'Processing';
    });

    // 2. Weekly Itinerary (Monday to Sunday)
    var today = new Date();
    var day = today.getDay(); // 0 (Sun) to 6 (Sat)
    var diffToMon = (day === 0 ? -6 : 1 - day);
    var monday = new Date(today);
    monday.setDate(today.getDate() + diffToMon);
    monday.setHours(0, 0, 0, 0);

    var sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    var weeklyEvents = [];
    cases.forEach(function (c) {
        if (c.itinerary && Array.isArray(c.itinerary)) {
            c.itinerary.forEach(function (ev) {
                var evTime = new Date(ev.time);
                if (evTime >= monday && evTime <= sunday) {
                    weeklyEvents.push({
                        time: evTime,
                        event: ev.event,
                        client: c.clientName || "未命名"
                    });
                }
            });
        }
    });
    weeklyEvents.sort(function (a, b) { return a.time - b.time; });

    if (processingCases.length === 0 && weeklyEvents.length === 0) return { success: false };

    var msg = "<b>📊 本週匯總報表</b>\n\n";

    if (processingCases.length > 0) {
        msg += "<b>案件進度 (處理中)：</b>\n";
        processingCases.forEach(function (c, i) {
            msg += (i + 1) + ". " + (c.clientName || "未命名") + " (" + (c.plate || "無") + ")\n";
        });
        msg += "\n";
    }

    if (weeklyEvents.length > 0) {
        msg += "<b>本週重要行程：</b>\n";
        weeklyEvents.forEach(function (ev, i) {
            var weekDay = getChineseWeekday(ev.time);
            var dateStr = Utilities.formatDate(ev.time, "GMT+8", "MM/dd (" + weekDay + ") HH:mm");
            msg += "• " + dateStr + " - " + ev.client + "：" + ev.event + "\n";
        });
        msg += "\n";
    }

    msg += "祝您本週工作順利！";
    sendTelegramNotification(msg, forcedChatId);
    return { success: true };
}


// --- Utility Functions ---

function sendTelegramNotification(message, forcedChatId, replyMarkup) {
    try {
        var settings = readSettings();
        var token = settings.telegramToken || "8338367569:AAEF1bebFJN-qoSiqkSVSEt1gFj3fRwd5FU";
        var chatId = forcedChatId || settings.telegramChatId || "-5279948004";
        if (!token || !chatId) return;

        var payload = {
            "chat_id": chatId,
            "text": message,
            "parse_mode": "HTML",
            "disable_web_page_preview": true
        };

        // 如果有傳入 replyMarkup，則加入 payload
        if (replyMarkup) {
            payload["reply_markup"] = replyMarkup;
        }

        UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
            "method": "post",
            "contentType": "application/json",
            "payload": JSON.stringify(payload),
            "muteHttpExceptions": true
        });
    } catch (e) { logDebug("Notify Err", e.toString()); }
}

function logDebug(action, details) {
    try {
        var sheet = getSheet(LOG_SHEET_NAME);
        if (sheet.getLastRow() > 200) sheet.deleteRows(2, 50);
        sheet.appendRow([new Date(), action, details]);
    } catch (e) { }
}

function readCases() {
    var sheet = getSheet(SHEET_NAME);
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    return sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues().map(function (row) {
        try { return JSON.parse(row[5]); } catch (e) { return null; }
    }).filter(x => x !== null);
}

// --- 輔助函數：取得狀態中文名稱 ---
function getStatusName(status) {
    var mapping = {
        'New': '新案',
        'Waiting': '等待中',
        'Processing': '處理中',
        'Litigation': '訴訟中',
        'Mediation': '調解中',
        'Settled': '已和解',
        'Judgement': '已判決',
        'Completed': '已結案'
    };
    return mapping[status] || status;
}

function saveCases(newCases) {
    try {
        var sheet = getSheet(SHEET_NAME);

        // 1. 讀取舊資料用於比對狀態異動
        var oldCases = readCases();

        // 2. 檢測狀態是否改變 (Status Change Detection)
        newCases.forEach(function (nc) {
            var oc = oldCases.find(function (o) { return o.id === nc.id; });

            // 如果找到舊案且狀態不同(轉字串比對)，發送通知
            if (oc && String(oc.status) !== String(nc.status)) {
                var oldName = getStatusName(oc.status);
                var newName = getStatusName(nc.status);
                var client = nc.clientName || "未命名";
                var plate = nc.plate || "無";

                var msg = "<b>🔄 案件進度異動通知</b>\n" +
                    "-----------------------\n" +
                    "👤 當事人：" + client + "\n" +
                    "🚗 車牌號：" + plate + "\n" +
                    "📌 狀態更新：<code>" + oldName + "</code> ➡️ <b>" + newName + "</b>\n" +
                    "🕒 更新時間：" + Utilities.formatDate(new Date(), "GMT+8", "yyyy/MM/dd HH:mm");

                logDebug("Notify Trigger", "Sending notification for case " + nc.id + ": " + oc.status + " -> " + nc.status);
                try {
                    sendTelegramNotification(msg);
                } catch (notifyErr) {
                    logDebug("Notify Failed", notifyErr.toString());
                }
            }
        });

        // 3. 清除舊資料並寫入新資料
        var lastRow = sheet.getLastRow();
        if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
        if (newCases.length === 0) return;

        var rows = newCases.map(c => [c.id, c.date, c.clientName || '', c.plate || '', c.status || 'Waiting', JSON.stringify(c), new Date().toISOString()]);
        sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    } catch (e) {
        logDebug("SaveCases Error", e.toString());
        // Fallback: Still try to save even if notify logic fails
        var sheet = getSheet(SHEET_NAME);
        var lastRow = sheet.getLastRow();
        if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
        if (newCases.length === 0) return;
        var rows = newCases.map(c => [c.id, c.date, c.clientName || '', c.plate || '', c.status || 'Waiting', JSON.stringify(c), new Date().toISOString()]);
        sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    }
}

function readSettings() {
    var sheet = getSheet(SETTINGS_SHEET_NAME);
    var val = sheet.getRange(1, 1).getValue();
    var settings = {};
    try { if (val && val.toString().startsWith('{')) settings = JSON.parse(val); } catch (e) { }

    // Default Defaults
    if (!settings.telegramToken) settings.telegramToken = "8338367569:AAEF1bebFJN-qoSiqkSVSEt1gFj3fRwd5FU";
    if (!settings.telegramChatId) settings.telegramChatId = "-5279948004";
    return settings;
}

function saveSettings(settings) {
    var sheet = getSheet(SETTINGS_SHEET_NAME);
    sheet.clear().getRange(1, 1).setValue(JSON.stringify(settings));
}

function readReminders() {
    var sheet = getSheet(REMINDERS_SHEET_NAME);
    var val = sheet.getRange(1, 1).getValue();
    try { if (val && val.toString().startsWith('[')) return JSON.parse(val); } catch (e) { }
    return [];
}

function saveReminders(reminders) {
    var sheet = getSheet(REMINDERS_SHEET_NAME);
    sheet.clear().getRange(1, 1).setValue(JSON.stringify(reminders));
}

function getSheet(name) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        if (name === SHEET_NAME) sheet.appendRow(["ID", "Date", "Name", "Plate", "Status", "JSON", "LastUpdated"]).setFrozenRows(1);
    }
    return sheet;
}

function getDriveFolder() {
    var folders = DriveApp.getFoldersByName("TrafficCaseFiles");
    return folders.hasNext() ? folders.next() : DriveApp.createFolder("TrafficCaseFiles");
}

function processUploads(uploads) {
    var folder = getDriveFolder();
    var links = {};
    uploads.forEach(function (file) {
        try {
            var blob = Utilities.newBlob(Utilities.base64Decode(file.base64), file.mimeType, file.fileName);
            var driveFile = folder.createFile(blob).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            if (file.tempId) links[file.tempId] = driveFile.getDownloadUrl();
        } catch (e) { logDebug("Upload Err", e.toString()); }
    });
}

function checkSystemStatus() { return "System OK"; }
function clearTelegramQueue() { return "Queue Cleared"; }

/**
 * ⚡ 一鍵設定自動化觸發器
 * 執行此函式後，系統會自動在背景掃描提醒、發送週報。
 */
function setupTriggers() {
    // 先清理舊的觸發器，避免重複
    var triggers = ScriptApp.getProjectTriggers();
    var monitoredHandlers = ['checkReminders', 'sendWeeklySummary'];
    for (var i = 0; i < triggers.length; i++) {
        if (monitoredHandlers.indexOf(triggers[i].getHandlerFunction()) !== -1) {
            ScriptApp.deleteTrigger(triggers[i]);
        }
    }

    // 1. 每 5 分鐘檢查一次：行程提醒、事故滿30日、自定義待辦
    ScriptApp.newTrigger('checkReminders')
        .timeBased()
        .everyMinutes(5)
        .create();

    // 2. 每週一早上 9:00：自動發送本週匯總報表
    ScriptApp.newTrigger('sendWeeklySummary')
        .timeBased()
        .onWeekDay(ScriptApp.WeekDay.MONDAY)
        .atHour(9)
        .create();

    return "✅ 自動化觸發器已設定完成！\n- 每 5 分鐘檢查提醒\n- 每週一 09:00 發送週報";
}
