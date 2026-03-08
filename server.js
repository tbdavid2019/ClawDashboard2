const http = require('http');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const chokidar = require('chokidar');
const url = require('url');

// Configuration
const WORKSPACE = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3002;
const HOST = process.env.HOST || '127.0.0.1';
const RESCAN_INTERVAL_MS = Number(process.env.RESCAN_INTERVAL_MS) || 5 * 60 * 1000; // 5 min
const REFRESH_INTERVAL_MS = Number(process.env.REFRESH_INTERVAL_MS) || 60 * 1000; // 1 min
const AGENT_ACTIVE_WINDOW_MS = Number(process.env.AGENT_ACTIVE_WINDOW_MS) || 15 * 60 * 1000; // 15 min
const AGENT_RECENT_WINDOW_MS = Number(process.env.AGENT_RECENT_WINDOW_MS) || 60 * 60 * 1000; // 1 hour
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH || path.join(os.homedir(), '.openclaw', 'openclaw.json');
const IGNORED_PATHS = [
    /(^|[\/\\])\../,       // dotfiles
    /node_modules/,        // node_modules
    /\.git/,               // git
    /dist/,                // build artifacts
    /coverage/,            // test coverage
];

// Load .dashboardignore
const IGNORE_FILE = path.join(WORKSPACE, '.dashboardignore');
let customIgnores = [];

try {
    if (fsSync.existsSync(IGNORE_FILE)) {
        const content = fsSync.readFileSync(IGNORE_FILE, 'utf8');
        customIgnores = content.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(pattern => new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); // Escape regex

        console.log('Loaded custom ignores:', customIgnores.map(r => r.source));
        IGNORED_PATHS.push(...customIgnores);
    }
} catch (e) {
    console.error('Error reading .dashboardignore:', e.message);
}

console.log(`Starting ClawDashboard2...`);
console.log(`Watching workspace: ${WORKSPACE}`);

// State
const agents = new Map();
const clients = new Set();
// Debounce map: agentId -> timeoutId
const updateQueue = new Map();
const ACTIVITY_IGNORED_DIRS = new Set([
    '.git',
    'node_modules',
    'dist',
    'coverage',
    '__pycache__',
    'archive',
    'logs',
    'tmp',
    'venv',
    '.venv'
]);
const ACTIVITY_ALLOWED_EXTENSIONS = new Set([
    '.md',
    '.json',
    '.js',
    '.cjs',
    '.mjs',
    '.ts',
    '.tsx',
    '.jsx',
    '.py',
    '.sh',
    '.yaml',
    '.yml'
]);
const AGENT_MARKER_FILES = new Set([
    'PROJECT.md',
    'MEMORY.md',
    'IDENTITY.md',
    'HEARTBEAT.md'
]);

// ---- 1. Markdown Parser (Async) ----
async function loadOpenclawConfig() {
    try {
        if (fsSync.existsSync(OPENCLAW_CONFIG_PATH)) {
            const raw = await fs.readFile(OPENCLAW_CONFIG_PATH, 'utf8');
            return JSON.parse(raw);
        }
    } catch (e) {
        console.warn('Failed to read openclaw.json:', e.message);
    }
    return null;
}

function getGatewayConfig(config) {
    return {
        port: config?.gateway?.port || 18789,
        token: config?.gateway?.auth?.token || null
    };
}

async function invokeGatewayTool(config, tool, args = {}) {
    const gw = getGatewayConfig(config);
    if (!gw.token) throw new Error('Missing gateway token');

    const url = `http://127.0.0.1:${gw.port}/tools/invoke`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${gw.token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ tool, args })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
        throw new Error(data?.error?.message || 'Gateway tool invoke failed');
    }
    return data.result;
}

function summarizeOpenclawConfig(config) {
    if (!config) return null;

    const agentsList = Array.isArray(config.agents?.list)
        ? config.agents.list.map(a => ({
            id: a.id,
            name: a.name,
            workspace: a.workspace,
            model: a.model
        }))
        : [];

    const defaults = {
        model: config.agents?.defaults?.model?.primary || config.agents?.defaults?.model || config.model?.primary || config.model || null,
        workspace: config.agents?.defaults?.workspace || null
    };

    const bindings = Array.isArray(config.bindings)
        ? config.bindings.map(b => ({
            agentId: b.agentId,
            channel: b.match?.channel,
            peer: b.match?.peer
        }))
        : [];

    const channels = config.channels
        ? Object.entries(config.channels).map(([key, val]) => ({
            channel: key,
            enabled: !!val.enabled,
            groupPolicy: val.groupPolicy,
            dmPolicy: val.dmPolicy,
            groupIds: val.groups ? Object.keys(val.groups) : [],
            dmIds: val.dms ? Object.keys(val.dms) : []
        }))
        : [];

    return {
        path: OPENCLAW_CONFIG_PATH,
        meta: config.meta || null,
        defaults,
        agents: agentsList,
        bindings,
        channels
    };
}

function extractDefaultModelFromConfig(config, agentDir) {
    if (!config) return null;

    const defaultsCfg = config.agents?.defaults || null;
    const list = Array.isArray(config.agents?.list) ? config.agents.list : [];

    // Match by workspace path in agents.list
    const entry = list.find(a => a.workspace && path.resolve(a.workspace) === path.resolve(agentDir));

    return (
        entry?.model ||
        entry?.defaultModel ||
        defaultsCfg?.model?.primary ||
        defaultsCfg?.model ||
        config.model?.primary ||
        config.model ||
        null
    );
}

function formatAgeShort(ms) {
    const totalMinutes = Math.max(1, Math.floor(ms / 60000));
    if (totalMinutes < 60) return `${totalMinutes}m`;

    const totalHours = Math.floor(totalMinutes / 60);
    if (totalHours < 24) return `${totalHours}h`;

    const totalDays = Math.floor(totalHours / 24);
    return `${totalDays}d`;
}

async function listAgentMarkers(directory) {
    const markers = [];
    for (const file of AGENT_MARKER_FILES) {
        try {
            await fs.access(path.join(directory, file));
            markers.push(file);
        } catch (e) {
            // Ignore missing marker files.
        }
    }
    return markers;
}

async function hasAgentMarkers(directory) {
    const markers = await listAgentMarkers(directory);
    return markers.length > 0;
}

async function findAgentRoot(startPath) {
    let current = startPath;
    try {
        const stat = await fs.stat(startPath);
        if (!stat.isDirectory()) {
            current = path.dirname(startPath);
        }
    } catch (e) {
        current = path.dirname(startPath);
    }

    const workspaceRoot = path.resolve(WORKSPACE);
    current = path.resolve(current);

    while (current.startsWith(workspaceRoot)) {
        if (await hasAgentMarkers(current)) {
            return current;
        }
        if (current === workspaceRoot) {
            break;
        }
        current = path.dirname(current);
    }

    return null;
}

async function getAgentActivity(directory, depth = 0) {
    let latest = { ts: 0, file: null };
    let touchedToday = 0;

    let entries = [];
    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (e) {
        return { lastUpdated: 0, latestFile: null, touchedToday: 0 };
    }

    const today = new Date().toISOString().slice(0, 10);

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            if (depth >= 2 || ACTIVITY_IGNORED_DIRS.has(entry.name) || isIgnored(fullPath)) {
                continue;
            }
            const nested = await getAgentActivity(fullPath, depth + 1);
            if (nested.lastUpdated > latest.ts) {
                latest = { ts: nested.lastUpdated, file: nested.latestFile };
            }
            touchedToday += nested.touchedToday || 0;
            continue;
        }

        const ext = path.extname(entry.name).toLowerCase();
        if (!ACTIVITY_ALLOWED_EXTENSIONS.has(ext)) {
            continue;
        }

        try {
            const stat = await fs.stat(fullPath);
            const mtime = stat.mtimeMs;
            if (mtime > latest.ts) {
                latest = { ts: mtime, file: path.relative(directory, fullPath) };
            }
            if (stat.mtime.toISOString().slice(0, 10) === today) {
                touchedToday += 1;
            }
        } catch (e) {
            // Ignore files deleted or changed mid-scan.
        }
    }

    return {
        lastUpdated: latest.ts,
        latestFile: latest.file,
        touchedToday
    };
}

function deriveStatus(declaredStatus, tasks, activity) {
    if (declaredStatus?.r === '❌' || declaredStatus?.r === '⏸️') {
        return declaredStatus;
    }

    const openTasks = (tasks || []).filter(t => t.status !== 'done' && t.status !== 'cancelled').length;
    const lastUpdated = activity?.lastUpdated || 0;
    if (!lastUpdated) {
        return declaredStatus || { r: '🟢', text: 'idle' };
    }

    const ageMs = Math.max(0, Date.now() - lastUpdated);
    const ageText = formatAgeShort(ageMs);
    const suffix = activity?.latestFile ? ` • ${activity.latestFile}` : '';

    if (ageMs <= AGENT_ACTIVE_WINDOW_MS) {
        return { r: '🟠', text: `active ${ageText} ago${suffix}` };
    }

    if (ageMs <= AGENT_RECENT_WINDOW_MS) {
        return { r: '🔵', text: `recent ${ageText} ago${suffix}` };
    }

    if (openTasks > 0) {
        return { r: '🟡', text: `pending • ${openTasks} open task${openTasks > 1 ? 's' : ''}` };
    }

    return { r: '🟢', text: `idle • last signal ${ageText} ago` };
}

async function parseAgentDirectory(directory) {
    try {
        const projectPath = path.join(directory, 'PROJECT.md');
        let content = '';
        let mtime = new Date(0);
        try {
            content = await fs.readFile(projectPath, 'utf8');
            const stat = await fs.stat(projectPath);
            mtime = stat.mtime;
        } catch (e) {
            content = '';
        }

        // Try to read MEMORY.md in the same directory
        let memory = '';
        const memoryPath = path.join(directory, 'MEMORY.md');
        try {
            memory = await fs.readFile(memoryPath, 'utf8');
        } catch (e) {
            // Ignore missing memory file
        }

        // Try to read IDENTITY.md in the same directory (for main agent)
        let identity = '';
        const identityPath = path.join(directory, 'IDENTITY.md');
        try {
            identity = await fs.readFile(identityPath, 'utf8');
        } catch (e) {
            // Ignore missing identity file
        }

        // Scan for other documents (*.md) excluding PROJECT.md, MEMORY.md, IDENTITY.md
        const docs = [];
        try {
            const files = await fs.readdir(directory);
            for (const file of files) {
                if (file.endsWith('.md') && !AGENT_MARKER_FILES.has(file)) {
                    docs.push(file);
                }
            }
        } catch (e) {
            console.error(`Error scanning docs in ${directory}:`, e.message);
        }

        // Optional runtime/usage metrics (if present)
        const metricsPaths = ['metrics.json', 'usage.json', 'runtime.json'];
        let metrics = {};
        for (const filename of metricsPaths) {
            try {
                const p = path.join(directory, filename);
                if (fsSync.existsSync(p)) {
                    const raw = await fs.readFile(p, 'utf8');
                    const parsed = JSON.parse(raw);
                    metrics = { ...metrics, ...parsed };
                }
            } catch (e) {
                console.warn(`Metrics read failed in ${directory}:`, e.message);
            }
        }

        // Extract Agent Name Priority:
        // 1. MEMORY.md (**Name:** / **Name**: / Name: ...)
        // 2. IDENTITY.md (**Name:** / **Name**: / Name: ...)
        // 3. PROJECT.md (# Title)
        // 4. Directory Name

        let name = null;

        const extractName = (text) => {
            if (!text) return null;
            const patterns = [
                /\*\*(?:Name|暱稱|姓名):\*\*\s*(.+)/i,           // **Name:** xxx
                /\*\*(?:Name|暱稱|姓名)\*\*\s*[:：]\s*(.+)/i,    // **Name**: xxx
                /^(?:Name|暱稱|姓名)\s*[:：]\s*(.+)$/im          // Name: xxx
            ];
            for (const re of patterns) {
                const m = text.match(re);
                if (m) return m[1].trim();
            }
            return null;
        };

        // Check MEMORY.md
        if (memory) {
            name = extractName(memory) || name;
        }

        // Check IDENTITY.md if no name yet
        if (!name && identity) {
            name = extractName(identity) || name;
        }

        // Check PROJECT.md H1 if no name yet
        if (!name) {
            const nameMatch = content.match(/^#\s+(.+)$/m);
            if (nameMatch) {
                name = nameMatch[1].trim();
            }
        }

        // Fallback to directory name
        if (!name) {
            name = path.basename(directory);
        }

        // Extract sections flexibly (support headings like # Status, ## Status, or inline "Status:" lines)
        const sections = extractSections(content);
        const tasks = parseTasks(sections['tasks']);
        const declaredStatus = parseStatus(sections['status'], content);
        const activity = await getAgentActivity(directory);

        const openclawConfig = await loadOpenclawConfig();
        const defaultModel =
            extractDefaultModelFromConfig(openclawConfig, directory) ||
            metrics.defaultModel ||
            metrics.model ||
            metrics.default_model ||
            null;
        const todayTokens = metrics.todayTokens ?? metrics.tokens ?? metrics.today_tokens ?? null;
        const todayCalls = metrics.todayCalls ?? metrics.calls ?? metrics.today_calls ?? null;

        return {
            id: directory, // Use directory path as unique ID
            name,
            status: deriveStatus(declaredStatus, tasks, activity),
            declaredStatus,
            markers: await listAgentMarkers(directory),
            tasks,
            log: parseLog(sections['log']),
            todayLogCount: Math.max(countTodayLogs(sections['log']), activity.touchedToday || 0),
            defaultModel,
            todayTokens,
            todayCalls,
            memory,
            docs, // List of other markdown files
            lastUpdated: Math.max(mtime.getTime(), activity.lastUpdated || 0),
            activity,
            directory
        };
    } catch (error) {
        console.error(`Error parsing ${directory}:`, error.message);
        return null;
    }
}

function normalizeSectionName(name) {
    return name.toLowerCase().replace(/[:\s]+$/, '').trim();
}

function splitSectionHeading(text) {
    const match = text.match(/^(.*?)(?:\s*[:\-—]\s*)(.+)$/);
    if (match) {
        return { name: match[1].trim(), inline: match[2].trim() };
    }
    return { name: text.trim(), inline: null };
}

function extractSections(content) {
    const sections = {};
    let currentSection = null;

    const lines = content.split('\n');
    for (const line of lines) {
        // Markdown headings (#, ##, ###, ...)
        const headingMatch = line.match(/^\s{0,3}#{1,6}\s*(.+?)\s*$/);
        if (headingMatch) {
            const { name, inline } = splitSectionHeading(headingMatch[1]);
            const sectionKey = normalizeSectionName(name);
            currentSection = sectionKey;
            if (!sections[sectionKey]) sections[sectionKey] = [];
            if (inline) sections[sectionKey].push(inline);
            continue;
        }

        // Inline section marker: "Status:", "Tasks -", "Log —"
        const inlineMatch = line.match(/^\s*(Status|Tasks|Log)\s*(?:[:\-—]\s*(.*))?$/i);
        if (inlineMatch) {
            const sectionKey = normalizeSectionName(inlineMatch[1]);
            currentSection = sectionKey;
            if (!sections[sectionKey]) sections[sectionKey] = [];
            if (inlineMatch[2] && inlineMatch[2].trim()) {
                sections[sectionKey].push(inlineMatch[2].trim());
            }
            continue;
        }

        if (currentSection && line.trim() !== '') {
            sections[currentSection].push(line);
        }
    }

    return sections;
}

function parseStatus(lines, rawContent) {
    if (!lines || lines.length === 0) {
        console.warn('Status parse: missing Status section. Raw content snippet:', (rawContent || '').slice(0, 500));
        return { r: '🟢', text: 'idle' }; // Default
    }

    // Find first line with emoji or text
    for (const line of lines) {
        // Use more robust regex for surrogate pair emojis
        const match = line.match(/^(\p{Emoji_Presentation}|\p{Extended_Pictographic})\s*(.*)/u);
        if (match) {
            return { r: match[1], text: match[2].trim() };
        }
        // Fallback for simple regex if needed
        const simpleMatch = line.match(/([🟢🔵🟡🟠🔴⏸️❌])\s*(.*)/);
        if (simpleMatch) {
            return { r: simpleMatch[1], text: simpleMatch[2].trim() };
        }

        // Fallback if no emoji found but text exists
        if (line.trim().length > 0) {
            return { r: '🟢', text: line.trim() };
        }
    }

    console.warn('Status parse: unable to extract status from lines:', lines);
    return { r: '🟢', text: 'idle' };
}

function parseTasks(lines) {
    if (!lines) return [];
    const tasks = [];

    // Support: - [ ], * [ ], + [ ], or bare [ ]
    const regex = /^\s*(?:[-*+]\s*)?\[([ xX\/!~])\]\s*(.*)/;

    lines.forEach(line => {
        const match = line.match(regex);
        if (match) {
            let status = 'todo';
            switch (match[1]) {
                case ' ': status = 'todo'; break;
                case '/': status = 'in-progress'; break;
                case 'x':
                case 'X': status = 'done'; break;
                case '!': status = 'blocked'; break;
                case '~': status = 'cancelled'; break;
            }

            tasks.push({
                status,
                text: match[2].trim(),
                raw: line
            });
        }
    });
    return tasks;
}

function parseLog(lines) {
    if (!lines) return [];
    // Just return raw lines for now, maybe parse dates later for activity heatmap
    return lines.map(line => line.replace(/^-\s*/, '')).filter(l => l.length > 0);
}

function countTodayLogs(lines) {
    if (!lines) return 0;
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const regex = new RegExp(`^(?:-\\s*)?\\[?${today}`);
    return lines.filter(line => regex.test(line)).length;
}

// ---- 2. File Watcher ----
const watcher = chokidar.watch(`${WORKSPACE}/**/*.md`, {
    ignored: IGNORED_PATHS,
    depth: 4, // Limit recursion depth
    persistent: true,
    ignoreInitial: true, // Don't fire 'add' for existing files on startup, we'll scan manually
    awaitWriteFinish: {
        stabilityThreshold: 1000, // Wait 1s for file writes to settle
        pollInterval: 100
    }
});

// Initial Scan
(async () => {
    console.log('Performing initial scan...');
    // We can just use the watcher's 'ready' event if we didn't ignoreInitial, 
    // but manual scan gives more control. For simplicity, let's just rely on
    // manual recursive scan or just let chokidar handle it without ignoreInitial=true next time.
    // Actually, ignoreInitial: false is better for startup state.
    // Let's reconfigure watcher to catch initial files but use the debounce logic.
})();


watcher
    .on('add', filePath => scheduleUpdate(filePath))
    .on('change', filePath => scheduleUpdate(filePath))
    .on('unlink', filePath => handleRemove(filePath))
    .on('error', error => console.error(`Watcher error: ${error}`));

// Handle removing agent
function handleRemove(filePath) {
    const base = path.basename(filePath);
    if (!AGENT_MARKER_FILES.has(base)) {
        return;
    }

    const directory = path.dirname(filePath);
    setTimeout(async () => {
        if (await hasAgentMarkers(directory)) {
            scheduleUpdate(directory);
            return;
        }
        if (agents.has(directory)) {
            console.log(`Agent removed: ${directory}`);
            agents.delete(directory);
            broadcast('remove', { id: directory });
        }
    }, 100);
}

async function upsertAgent(agentDir) {
    const agent = await parseAgentDirectory(agentDir);
    if (agent) {
        agents.set(agent.id, agent);
        broadcast('update', agent);
    }
}

// Debounced Update Logic
function scheduleUpdate(filePath) {
    const immediateDir = path.extname(filePath) ? path.dirname(filePath) : filePath;
    const agentDirHint = agents.has(immediateDir) ? immediateDir : null;

    // Use immediateDir as key for debouncing resolution work
    if (updateQueue.has(immediateDir)) {
        clearTimeout(updateQueue.get(immediateDir));
    }

    // Set a new timeout (Debounce 500ms)
    const timeoutId = setTimeout(async () => {
        updateQueue.delete(immediateDir); // Remove from queue when executing

        try {
            const agentDir = agentDirHint || await findAgentRoot(filePath);
            if (!agentDir) {
                return;
            }

            console.log(`Updating agent: ${agentDir}`);
            await upsertAgent(agentDir);
        } catch (err) {
            console.error(`Update failed for ${immediateDir}:`, err.message);
        }
    }, 500);

    updateQueue.set(immediateDir, timeoutId);
}

// Perform initial population (Sync is fine for startup)
function initialScan() {
    // This is a simple recursive scan helper if we wanted to avoid chokidar initial bloat
    // But chokidar with ignoreInitial:false is easier. 
    // Let's just stick to chokidar for now, but since we set ignoreInitial:true above (to avoid flood),
    // we should manually find agents once.

    // Actually, let's revert to ignoreInitial: false for simplicity, 
    // but handle the 'add' events with the same debounce logic.
    // The previous implementation used ignoreInitial: false (default).
    // Let's restart watcher with better settings.
}

// Since we can't easily change const watcher, let's just use a manual scan for now
// or rely on the user modifying files to trigger. 
// WAIT, the best way for a robust dashboard is to scan once at startup.
// Helper to check if path is ignored
function isIgnored(filePath) {
    return IGNORED_PATHS.some(regex => regex.test(filePath));
}

async function scanWorkspace(dir) {
    try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const names = new Set(entries.map(entry => entry.name));
        const hasMarkers = Array.from(AGENT_MARKER_FILES).some(file => names.has(file));
        if (hasMarkers) {
            scheduleUpdate(dir);
        }

        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            // Respect ignores
            if (isIgnored(fullPath)) {
                continue;
            }

            if (entry.isDirectory()) {
                await scanWorkspace(fullPath);
            }
        }
    } catch (e) {
        console.error(`Scan error in ${dir}:`, e.message);
    }
}

// Trigger initial scan
scanWorkspace(WORKSPACE);

// Periodic refresh (fallback in case watcher misses events)
let refreshInProgress = false;
async function refreshAllAgents() {
    if (refreshInProgress) return;
    refreshInProgress = true;
    try {
        for (const id of agents.keys()) {
            try {
                if (await hasAgentMarkers(id)) {
                    await upsertAgent(id);
                } else {
                    agents.delete(id);
                    broadcast('remove', { id });
                }
            } catch (e) {
                // ignore missing/permission issues
            }
        }
    } finally {
        refreshInProgress = false;
    }
}

let rescanInProgress = false;
async function rescanWorkspace() {
    if (rescanInProgress) return;
    rescanInProgress = true;
    try {
        await scanWorkspace(WORKSPACE);
    } finally {
        rescanInProgress = false;
    }
}

setInterval(refreshAllAgents, REFRESH_INTERVAL_MS).unref();
setInterval(rescanWorkspace, RESCAN_INTERVAL_MS).unref();


// ---- 3. SSE & HTTP Server ----
function broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
        res.write(message);
    }
}

const server = http.createServer(async (req, res) => {
    // 1. CORS for dev
    res.setHeader('Access-Control-Allow-Origin', '*');

    // 2. Parse URL
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    // 3. SSE Endpoint
    if (pathname === '/api/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });

        clients.add(res);
        // Send initial data immediately
        const initialData = Array.from(agents.values());
        res.write(`event: init\ndata: ${JSON.stringify(initialData)}\n\n`);

        req.on('close', () => clients.delete(res));
        return;
    }

    // 4. API Endpoint (Snapshot)
    if (pathname === '/api/agents') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(Array.from(agents.values())));
        return;
    }

    // 5. File Content API (read)
    if (pathname === '/api/file' && req.method === 'GET') {
        const { id, file } = parsedUrl.query;
        if (!id || !file) {
            res.writeHead(400);
            res.end('Missing id or file params');
            return;
        }

        // Security check: ensure id is a known agent directory
        if (!agents.has(id)) {
            res.writeHead(403);
            res.end('Access denied: Unknown agent');
            return;
        }

        // Security check: prevent directory traversal
        const targetPath = path.join(id, path.basename(file));

        // Double check it's within the agent dir
        if (path.dirname(targetPath) !== id) {
            res.writeHead(403);
            res.end('Access denied: File must be in agent directory');
            return;
        }

        try {
            const content = await fs.readFile(targetPath, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(content);
        } catch (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404);
                res.end('File not found');
            } else {
                res.writeHead(500);
                res.end('Error reading file');
            }
        }
        return;
    }

    // 5b. File Content API (write)
    if (pathname === '/api/file' && req.method === 'POST') {
        const { id, file } = parsedUrl.query;
        if (!id || !file) {
            res.writeHead(400);
            res.end('Missing id or file params');
            return;
        }

        if (!agents.has(id)) {
            res.writeHead(403);
            res.end('Access denied: Unknown agent');
            return;
        }

        const targetPath = path.join(id, path.basename(file));
        if (path.dirname(targetPath) !== id) {
            res.writeHead(403);
            res.end('Access denied: File must be in agent directory');
            return;
        }

        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                await fs.writeFile(targetPath, body, 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('OK');
                // trigger update
                scheduleUpdate(targetPath);
            } catch (e) {
                res.writeHead(500);
                res.end('Error writing file');
            }
        });
        return;
    }

    // 6. OpenClaw Config (raw)
    if (pathname === '/api/openclaw/raw') {
        try {
            const raw = await fs.readFile(OPENCLAW_CONFIG_PATH, 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end(raw);
        } catch (e) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('openclaw.json not found');
        }
        return;
    }

    // 6. OpenClaw Config Summary
    if (pathname === '/api/openclaw') {
        const config = await loadOpenclawConfig();
        const summary = summarizeOpenclawConfig(config);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ...(summary || {}), raw: config || {} }));
        return;
    }

    if (pathname === '/api/openclaw/raw') {
        const config = await loadOpenclawConfig();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(config || {}));
        return;
    }

    // 6b. Sessions List
    if (pathname === '/api/sessions') {
        try {
            const config = await loadOpenclawConfig();
            const result = await invokeGatewayTool(config, 'sessions_list', { limit: 50, messageLimit: 0 });
            const sessions = result?.details?.sessions || result?.sessions || [];
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ sessions, count: sessions.length }));
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: e.message }));
        }
        return;
    }

    // 7. Static Files
    if (pathname === '/' || pathname === '/index.html') {
        try {
            const content = await fs.readFile(path.join(__dirname, 'index.html'), 'utf8');
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(content);
        } catch (err) {
            res.writeHead(500);
            res.end('Error loading index.html');
        }
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

// ---- 4. Global Error Handling ----
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    // Keep running if possible, but logging is crucial
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
});

server.listen(PORT, HOST, () => {
    console.log(`Dashboard running at http://${HOST}:${PORT}`);
});
