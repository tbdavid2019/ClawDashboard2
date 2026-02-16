# ClawDashboard2

**File-first 多 Agent 監控面板** — 不靠 API 回報，靠 `.md` 檔共編。

## 核心理念

ClawDashboard v1 的根本問題是「被動架構」— Agent 必須主動打 API 才能讓 Dashboard 知道狀態。
新 Agent 不知道要打 API、忘了打就整個面板空白。

ClawDashboard2 反過來：

> **Dashboard 主動讀取 Agent 的 project `.md` 檔。**
> Agent 只需按規範維護自己的 `.md`，不需要知道 Dashboard 的存在。

## 架構對比

| | v1 (ClawDashboard) | v2 (ClawDashboard2) |
|:---|:---|:---|
| 資料來源 | Agent 打 API 回報 | Dashboard 讀取 `.md` 檔 |
| Agent 耦合 | 高（必須知道 API） | **零**（只維護自己的 `.md`）|
| 新 Agent 支援 | 需手動教學 | **自動**（有 `.md` 就能讀）|
| Task 積累 | 永久存 SQLite | **Agent 自行管理 + 歸檔** |
| 技術棧 | React + Vite + Express + SQLite | **單檔 HTML + Node.js** |
| npm 依賴 | ~200 packages | **1 package** (chokidar) |
| 安裝時間 | 30-60 秒 | **< 2 秒** |
| 檔案數 | 數百個 | **3 個** |
| 啟動 | npm run dev (2 processes) | `node server.js` (1 process) |

---

## 🚀 Quick Start (快速開始)

## 🚀 Quick Start (快速開始)

### 🧑‍💻 For Humans (人類用戶)

請複製以下 Prompt 並貼給你的 **OpenClaw**：

```
請幫我安裝 ClawDashboard2。

請閱讀此安裝指南並執行：
https://raw.githubusercontent.com/tbdavid2019/ClawDashboard2/main/docs/INSTALL.md

(請務必先問我 Workspace Root 在哪裡，再決定安裝位置)
(含 Port 檢查、PROJECT.md 初始化、Sub-Agent 協議)
(之後若新增 Sub-Agent，也請務必幫它們建立 PROJECT.md 並定期檢查)
(若需移除，請參閱指南中的 Uninstallation 章節執行徹底清除)
```

---

### 🤖 For OpenClaw Agent

當人類貼上上述 Prompt 時，請執行以下步驟：

1.  **讀取指南**：
    ```bash
    curl -s https://raw.githubusercontent.com/tbdavid2019/ClawDashboard2/main/docs/INSTALL.md
    ```
2.  **執行安裝**：按照指南中的步驟操作 (Clone -> Install -> Run -> Initial Protocol)。


---

## 📂 Project Structure

```
ClawDashboard2/
├── docs/               # 設計文件 & 安裝指南
├── server.js           # 核心邏輯 (File Watcher + SSE)
├── index.html          # 前端介面
└── package.json        # 依賴設定
```

---

## 設計文件

開發前必讀：

| 檔案 | 說明 |
|:---|:---|
| [ARCHITECTURE.md](./docs/ARCHITECTURE.md) | 系統架構、資料流、File Watcher 機制 |
| [PROJECT_MD_SPEC.md](./docs/PROJECT_MD_SPEC.md) | `PROJECT.md` 檔案格式規範（Agent 必讀）|
| [AGENT_GUIDE.md](./docs/AGENT_GUIDE.md) | Agent 如何維護 `PROJECT.md`（含任務清理）|
| [DASHBOARD_SPEC.md](./docs/DASHBOARD_SPEC.md) | 前後端 UI/API 規格 |
| [LESSONS_FROM_V1.md](./docs/LESSONS_FROM_V1.md) | v1 踩過的坑與經驗教訓 |

---

## 多 Agent 範例

```
/home/david/project/               ← WORKSPACE_ROOT
├── clawd/                          ← 主 Agent
│   └── PROJECT.md                  ← 含 ## Sub-Agents 索引
├── clawd-voice/                    ← 子 Agent
│   └── PROJECT.md
├── clawd-invest/                   ← 子 Agent
│   └── PROJECT.md
└── ClawDashboard2/                 ← Dashboard 本身（不被掃描）
```

Dashboard 自動偵測所有含 `PROJECT.md` 的目錄 = Agent。
新增子 Agent 時，只要建立 `PROJECT.md` 就會自動出現在 Dashboard。

---