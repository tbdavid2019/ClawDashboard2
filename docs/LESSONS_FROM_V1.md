# ClawDashboard v1 經驗教訓

開發 ClawDashboard v1 時學到的經驗，v2 必須避免或改善的地方。

---

## 1. 安裝流程

### ✅ 好的做法（保留）

- **一行指令安裝**：`bash <(curl -sSL ...)` — 使用者不需要手動 clone
- **自動偵測 OS**：Linux (x86/ARM/Raspberry Pi) + macOS
- **自動處理 Port 衝突**：腳本會偵測並提示
- **互動式選擇**：問 local/LAN 模式
- **PM2 管理**：背景常駐、開機自啟

### ❌ 踩過的坑（避免）

| 問題 | v1 做法 | v2 改進 |
|:---|:---|:---|
| 路徑寫死 | `~/.openclaw/workspace/ClawDashboard` | 安裝到任意目錄，`setup.sh --workspace` |
| CORS 寫死 | Hardcode `localhost` | 從 `.env` 讀取 `CORS_ORIGINS`，預設 `*` |
| 管理指令綁路徑 | `cd ~/.openclaw/workspace/...` | `find_project_dir()` 自動搜尋 |
| 安裝後無文件讀取 | 沒提醒 Agent 讀 docs | 安裝完自動提示讀取 `backend/docs/*.md` |

---

## 2. README 寫法

### ✅ AI Agent prompt 用 code block

給 Agent 的提示詞用 ``` code block 包裹，不要用 `>` blockquote。
原因：使用者可以直接一鍵複製整段文字貼給 Agent。

```
這是使用者可以直接複製的提示詞
不需要一行一行選取
```

### ❌ 不要用 HTML details/summary

摺疊區塊在 README 裡反而讓重要資訊藏起來，使用者看不到。
所有說明都直接展開顯示。

### ❌ 不要用 blockquote 做 prompt

`>` 在 GitHub 上渲染成引用區塊，無法一鍵複製。

---

## 3. 反安裝 (Uninstall)

### 必須做的事

1. **停止 PM2 服務**：`pm2 stop` + `pm2 delete` + `pm2 save`
2. **提示備份資料**：問使用者是否要備份（v1 是 `bot.db`，v2 不一定有 DB）
3. **刪除專案檔案**：確認後 `rm -rf`
4. **LLM 記憶清理（最重要！）**：

```
請清除所有 ClawDashboard 相關的長期記憶：
1. 刪除 memory/ 下所有 claw-dashboard 相關檔案
2. 從 MEMORY.md 移除 ClawDashboard 相關索引
3. 確認記憶已清理乾淨
```

不清理 LLM 記憶 = 記憶污染。Agent 會繼續用已刪除專案的舊知識做決策。

### v2 的改進空間

- `setup.sh --uninstall` 可以自動掃描 `MEMORY.md` 並列出相關行，讓使用者確認刪除
- 或者提供一個 `--purge-memory` flag 自動清理

---

## 4. 多 Agent 場景

### v1 的問題

1. Dashboard 資料來源是 API — Agent 不打 API 就沒資料
2. 新 Agent 不知道 Dashboard → 不會打 API
3. 沒有 Task 清理機制 → DB 無限增長

### v2 的解法

1. **File-first** — Agent 只維護 `PROJECT.md`，Dashboard 主動讀取
2. **自動發現** — 有 `PROJECT.md` 的目錄 = Agent，不需要註冊
3. **Agent 自治清理** — Task 清理是 Agent 的職責，寫在 `PROJECT.md` 裡

---

## 5. 部署經驗

### 網路模式

- **Local** (`HOST=127.0.0.1`)：只開發者本人可看到
- **LAN** (`HOST=0.0.0.0`)：區網內其他機器可連入，需搭配 `CORS_ORIGINS=*`

### PATH 解析

- 不要 hardcode 任何路徑
- 用 `__dirname` 或 `process.cwd()` 為起點
- 提供 auto-detect function（如 v1 的 `findOpenclawDir()`），同時支援 `.env` 覆蓋

### 防火牆

- Linux LAN 模式需開 port：`sudo ufw allow 3001` + `sudo ufw allow 5173`
- macOS 不需要（但要注意 AirPlay 佔用 5000）
