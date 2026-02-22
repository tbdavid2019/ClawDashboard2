# PROJECT.md 檔案規範

每個 Agent workspace 的根目錄必須有一個 `PROJECT.md`。
Dashboard 透過解析此檔案來顯示 Agent 的狀態、任務、日誌。

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

## 最小範例

```markdown
# clawd-voice

## Status

🟢 idle

## Tasks

- [x] 2024-01-15 語音轉文字模組優化
- [x] 2024-01-16 TTS 音色調整
- [ ] 2024-01-17 多語言支援

## Log

- 2024-01-17 10:30 開始研究多語言 TTS 方案
- 2024-01-16 15:00 完成音色調整，已部署
```

---

## 各 Section 規範

### `# 標題` (第一行)

Agent 的顯示名稱。Dashboard 用這個做 sidebar 標題。

### `## Status`

**自由描述，不限定分類。** Agent 用自己的語言描述目前在做什麼。

Dashboard 用第一個 emoji 決定顏色，`—` 後面的文字顯示在狀態燈旁邊。

#### Emoji 色碼對照

| Emoji | Dashboard 顯示 | 典型場景 |
|:---|:---|:---|
| 🟢 | 綠燈 (idle) | 閒置、等待指令 |
| 🔵 | 藍燈 (reading) | 讀取程式碼、研究文件、分析需求 |
| 🟡 | 黃燈 (planning) | 規劃方案、設計架構 |
| 🟠 | 橙燈 (building) | 寫程式、修改檔案 |
| 🔴 | 紅燈 (testing) | 跑測試、驗證結果 |
| ⏸️ | 灰燈 (blocked) | 等待使用者確認、等待外部資源 |
| ❌ | 紅閃 (error) | 執行失敗、需要排錯 |

#### 範例

```markdown
## Status

🟢 idle
```

```markdown
## Status

🔵 reading — 研究 server.js 的 CORS 設定邏輯
```

```markdown
## Status

🟡 planning — 設計多語言 TTS 方案，預計修改 3 個檔案
```

```markdown
## Status

🟠 building — 實作 WebSocket 連線池，進度 2/5
```

```markdown
## Status

🔴 testing — 跑 unit tests，目前 23/30 pass
```

```markdown
## Status

⏸️ blocked — 等使用者確認要用 Coqui TTS 還是 Edge TTS
```

```markdown
## Status

❌ error — npm install 失敗：node v14 太舊，需要 >= 18
```

**重點：描述要具體。** 不要寫「working」，要寫「正在修改 auth.js 的 token 驗證邏輯」。

### `## Tasks`

使用 Markdown checklist 格式：

```markdown
## Tasks

- [ ] 待辦任務標題
- [/] 進行中的任務標題
- [x] 已完成的任務標題
- [!] 失敗/被擋住的任務
- [~] 已取消的任務
```

| 符號 | 狀態 | 說明 |
|:---|:---|:---|
| `- [ ]` | todo | 待辦 |
| `- [/]` | in_progress | 進行中 |
| `- [x]` | done | 已完成 |
| `- [!]` | blocked / failed | 被擋住或失敗（說明原因）|
| `- [~]` | cancelled | 已取消（不需要做了）|

**建議格式**：日期 + 標題 + 可選描述

```markdown
- [x] 2024-01-15 語音轉文字模組優化
- [/] 2024-01-17 多語言支援研究
- [!] 2024-01-18 Whisper v4 整合 — node 版本不相容，等升級後再做
- [~] 2024-01-12 舊版 API 遷移 — 已由 clawd-sre 接手
- [ ] 2024-01-20 整合 Whisper v4
```

**任務清理**：Agent 自行負責。建議保留最近 30 天的已完成任務，更舊的移到 `ARCHIVE.md`。

### `## Log`

時間倒序排列的活動日誌：

```markdown
## Log

- 2024-01-17 10:30 開始研究多語言 TTS 方案
- 2024-01-16 15:00 完成音色調整，已部署到 production
- 2024-01-16 14:00 發現 Edge TTS 延遲過高，改用 Coqui
```

**格式**（推薦）: `- YYYY-MM-DD HH:MM 描述`

**相容格式**（仍可被 Dashboard 計數/顯示）:
- `[YYYY-MM-DD] 描述`
- `- [YYYY-MM-DD] 描述`

**清理**：保留最近 7 天，更舊的移到 `ARCHIVE.md`。

### `## Sub-Agents` (僅主 Agent)

主 Agent 索引所有子 Agent：

```markdown
## Sub-Agents

| Agent | 目錄 | 負責領域 |
|:---|:---|:---|
| clawd-voice | ../clawd-voice/ | 語音處理 |
| clawd-invest | ../clawd-invest/ | 投資分析 |
| clawd-sre | ../clawd-sre/ | 系統維運 |
```

---

## 可選 Section

以下 Dashboard 會解析（如果存在），但不強制：

### `## Config`

```markdown
## Config

- LLM: gpt-4o
- Provider: openai
- Temperature: 0.7
```

### `## Metrics`

```markdown
## Metrics

| Model | Calls | Tokens |
|:---|:---|:---|
| gpt-4o | 142 | 285,000 |
| claude-3.5 | 89 | 178,000 |
```

---

## Dashboard 解析規則

1. 以 `##` heading 為分隔，每個 section 獨立解析
2. **Status** — 取第一個非空行，用第一個 emoji 決定顏色，`—` 後為描述
3. **Tasks** — 解析 `- [ ]`、`- [/]`、`- [x]`、`- [!]`、`- [~]` 五種狀態
4. **Log** — 每行 `- ` 開頭的都是一條日誌
5. **未知 section** — 忽略，不報錯（向前相容）
