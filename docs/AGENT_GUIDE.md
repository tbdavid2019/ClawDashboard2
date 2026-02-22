# Agent 指南 — 如何維護 PROJECT.md

你（Agent）不需要知道 Dashboard 存在，不需要打任何 API。
你只需要在工作時維護你的 `PROJECT.md`，如實描述你在做什麼。

---

## 🚨 Mandatory Protocol (絕對準則)

為了確保 Dashboard 的即時性與準確性，所有 Agent 必須遵守以下規則：

1.  **Start Task (開工)**:
    *   在執行任何任務前，**必須**先將 `## Status` 更新為 `🔵 working — [任務名稱]` 或 `🟠 building — [任務名稱]`。
    *   **嚴禁** 在 `🟢 idle` 狀態下偷偷執行任務。

2.  **Finish Task (完工)**:
    *   任務完成後，**必須**將 `## Status` 更新回 `🟢 idle — 待命中`。
    *   **必須** 在 `## Tasks` 中勾選已完成的項目 (`- [x]`)。
    *   **必須** 在 `## Log` 中新增一條執行紀錄。

3.  **Persistence (記憶)**:
    *   Agent 必須將此 Protocol 寫入自己的長期記憶 (`MEMORY.md`)，以免遺忘。

---

## Agent Naming (IDENTITY.md)

請在 workspace 根目錄建立 `IDENTITY.md`，並用以下格式（**必須一致**）：

```markdown
# Identity

- **Name**: Your Agent Name
- **Role**: ...
- **Emoji**: ...
```

Dashboard 會讀 `IDENTITY.md`（或 `MEMORY.md`）作為顯示名稱。

## 你的唯一職責

在你的 workspace 根目錄維護一個 `PROJECT.md`：

```
/home/david/project/clawd-voice/
├── PROJECT.md          ← 你維護這個
├── src/
└── ...
```

---

## 什麼時候更新 Status

**每次你的工作狀態改變時**，更新 `## Status`。用你自己的語言描述：

```markdown
## Status

🔵 reading — 研究 audio.ts 的合併邏輯
```

```markdown
## Status

🟡 planning — 設計新的 WAV merge 方案，需要處理 header 對齊
```

```markdown
## Status

🟠 building — 重寫 combineAudioBuffers()，進度 1/3
```

```markdown
## Status

🔴 testing — 跑合併測試，確認 10 分鐘音檔可正常播放
```

```markdown
## Status

🟢 idle
```

**描述要具體**：不要寫「working」，要寫「修改 auth.js 的 JWT 過期邏輯」。

### 被卡住或出錯時

```markdown
## Status

⏸️ blocked — 等使用者決定用哪個 TTS provider
```

```markdown
## Status

❌ error — build 失敗：Cannot find module 'chokidar'
```

---

## Task 管理

### 新增任務

在 `## Tasks` 最上方加入：

```markdown
- [ ] 2024-01-20 整合 Whisper v4
```

### 狀態標記

```markdown
- [ ] 待辦
- [/] 進行中
- [x] 已完成
- [!] 被卡住 — 原因說明
- [~] 已取消 — 原因說明
```

### 完整範例

```markdown
## Tasks

- [/] 2024-01-20 整合 Whisper v4
- [!] 2024-01-19 升級 Node.js — 生產環境有依賴，等 SRE 確認
- [x] 2024-01-17 多語言 TTS 支援
- [x] 2024-01-16 TTS 音色調整
- [~] 2024-01-15 遷移舊 API — 改由 clawd-sre 負責
```

### 清理

**每週一次**，將超過 30 天的已完成/已取消任務移到 `ARCHIVE.md`：

```markdown
<!-- ARCHIVE.md -->
# 已歸檔任務

## 2024-01

- [x] 2024-01-10 建立語音 pipeline
- [x] 2024-01-05 設定開發環境
- [~] 2024-01-03 評估 Azure TTS — 太貴放棄
```

---

## Log 維護

### 格式

推薦：
```
- YYYY-MM-DD HH:MM 做了什麼事
```

相容（Dashboard 仍可計數/顯示）：
```
[YYYY-MM-DD] 做了什麼事
- [YYYY-MM-DD] 做了什麼事
```

### 寫什麼

- 重要決策（為什麼選 A 不選 B）
- 部署和上線
- 發現的問題和解法
- 不需要記錄每一步操作

### 清理

保留最近 7 天。更舊的移到 `ARCHIVE.md` 的 `## Log Archive`。

---

## 如果你是 Main Agent

你的 `PROJECT.md` 多一個 `## Sub-Agents` section：

```markdown
## Sub-Agents

| Agent | 目錄 | 負責領域 |
|:---|:---|:---|
| clawd-voice | ../clawd-voice/ | 語音處理 |
| clawd-invest | ../clawd-invest/ | 投資分析 |
| clawd-sre | ../clawd-sre/ | 系統維運 |
```

### 新建子 Agent 時

1. 在 Sub-Agents 表格新增一行
2. 告訴新子 Agent：「**在你的根目錄建立 `PROJECT.md`，參照這個格式維護你的狀態和任務**」
3. 不需要替子 Agent 維護狀態 — 每個 Agent 管自己的

---

## 不要做的事

- ❌ 不要打 Dashboard API（沒有 API）
- ❌ 不要把 `PROJECT.md` 放在子目錄（必須在 workspace 根目錄）
- ❌ 不要刪除 `## Status`、`## Tasks`、`## Log` heading
- ❌ Status 描述不要寫模糊的「working」「busy」，要寫具體動作
