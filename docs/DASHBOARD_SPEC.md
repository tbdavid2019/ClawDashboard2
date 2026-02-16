# Dashboard 規格

Dashboard 只有兩個檔案：`server.js` + `index.html`。

---

## server.js 職責

### 1. File Watcher（chokidar）

```javascript
chokidar.watch(`${WORKSPACE_ROOT}/**/PROJECT.md`, {
  depth: 2,
  ignored: ['**/node_modules/**', '**/.git/**', '**/ClawDashboard2/**'],
  awaitWriteFinish: { stabilityThreshold: 500 }
});
```

- 監控所有 `PROJECT.md` 的新增、修改、刪除
- 500ms debounce 避免重複觸發
- 解析後存在記憶體 `Map` 中

### 2. Markdown Parser

解析 `PROJECT.md` 各 section：

```javascript
function parseProjectMd(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const sections = splitBySections(content);

  return {
    name:      parseTitle(content),             // # 標題
    status:    parseStatus(sections['Status']), // 🟢🟡🔴 + 描述
    tasks:     parseTasks(sections['Tasks']),   // [ ] [/] [x]
    log:       parseLog(sections['Log']),       // timestamped entries
    subAgents: parseTable(sections['Sub-Agents']),
    mtime:     fs.statSync(filePath).mtime,
    directory: path.dirname(filePath)
  };
}
```

### 3. SSE 推送

```javascript
// GET /api/events
// 檔案變動 → broadcast → 前端即時更新
```

### 4. HTTP 路由

| Method | Path | 回應 |
|:---|:---|:---|
| `GET` | `/` | 靜態 serve `index.html` |
| `GET` | `/api/agents` | JSON：所有 agent 的 parsed data |
| `GET` | `/api/events` | SSE stream |

**只有 3 個路由。不需要 CRUD、不需要 POST/PUT/DELETE。**
Dashboard 是唯讀的。

### 5. 靜態檔案

直接用 Node.js 內建 `http` 模組 serve `index.html`，不需要 Express：

```javascript
const server = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(fs.readFileSync('./index.html'));
  }
  // ...
});
```

---

## index.html 結構

單檔，所有 CSS + JS 都內嵌。

### Layout

```
┌──────────────────────────────────────────┐
│ ClawDashboard2              🟢 All idle  │  ← Header
├─────────┬────────────────────────────────┤
│ Agents  │  Agent Detail                  │
│         │                                │
│ 🟢 clawd│  # clawd-voice                │
│ 🟡 voice│  Status: 🟡 thinking           │
│ 🟢 invest│                               │
│         │  ## Tasks                      │
│         │  ☑ 語音優化     ☐ 多語言支援    │
│         │                                │
│         │  ## Log                        │
│         │  10:30 開始研究...              │
│         │  09:00 完成部署...              │
├─────────┴────────────────────────────────┤
│ Overview: 3 agents, 2 tasks in progress  │  ← Footer
└──────────────────────────────────────────┘
```

### 前端技術

- **SSE**：`new EventSource('/api/events')` — 即時更新
- **DOM 操作**：vanilla `document.createElement` / `innerHTML`
- **CSS**：內嵌在 `<style>` 標籤，使用 CSS Grid layout
- **無依賴**：不需要 React、Vue、jQuery

### 初始載入

```javascript
// 1. 一次性拿所有 agent 資料
fetch('/api/agents').then(r => r.json()).then(renderAll);

// 2. 之後靠 SSE 增量更新
const es = new EventSource('/api/events');
es.addEventListener('update', e => renderAgent(JSON.parse(e.data)));
es.addEventListener('remove', e => removeAgent(JSON.parse(e.data)));
```

---

## 設定

### 環境變數

| 變數 | 預設值 | 說明 |
|:---|:---|:---|
| `WORKSPACE_ROOT` | `.` | Agent workspace 父目錄（必填）|
| `PORT` | `3001` | HTTP 端口 |
| `HOST` | `127.0.0.1` | `0.0.0.0` = LAN 模式 |

### 啟動

```bash
# 最簡啟動
WORKSPACE_ROOT=/home/david/project node server.js

# 或用 .env
echo "WORKSPACE_ROOT=/home/david/project" > .env
node server.js

# PM2
pm2 start server.js --name claw2
```

---

## 不做的事

- ❌ 不寫入 Agent 的 `PROJECT.md`
- ❌ 不維護 SQLite / 任何 DB
- ❌ 不需要 build step
- ❌ 不提供 CRUD API
- ❌ 不需要 Express / React / Vite
