const http = require('http');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const url = require('url');

// Configuration
const WORKSPACE = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3002;
const IGNORED_PATHS = [
    /(^|[\/\\])\../,       // dotfiles
    /node_modules/,        // node_modules
    /\.git/,               // git
    /ClawDashboard2/,      // self
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

// ---- 1. Markdown Parser (Async) ----
async function parseProjectMd(filePath) {
    try {
        // Use async file reading to prevent blocking the event loop
        const content = await fs.readFile(filePath, 'utf8');
        const stat = await fs.stat(filePath);
        const mtime = stat.mtime;
        const directory = path.dirname(filePath);

        // Try to read MEMORY.md in the same directory
        let memory = '';
        const memoryPath = path.join(directory, 'MEMORY.md');
        try {
            memory = await fs.readFile(memoryPath, 'utf8');
        } catch (e) {
            // Ignore missing memory file
        }

        // Scan for other documents (*.md) excluding PROJECT.md and MEMORY.md
        const docs = [];
        try {
            const files = await fs.readdir(directory);
            for (const file of files) {
                if (file.endsWith('.md') && file !== 'PROJECT.md' && file !== 'MEMORY.md') {
                    docs.push(file);
                }
            }
        } catch (e) {
            console.error(`Error scanning docs in ${directory}:`, e.message);
        }

        // Extract Agent Name from H1
        const nameMatch = content.match(/^#\s+(.+)$/m);
        const name = nameMatch ? nameMatch[1].trim() : path.basename(directory);

        // Split by H2 sections
        const sections = {};
        let currentSection = null;

        content.split('\n').forEach(line => {
            const sectionMatch = line.match(/^##\s+(.+)$/);
            if (sectionMatch) {
                currentSection = sectionMatch[1].trim();
                sections[currentSection] = [];
            } else if (currentSection && line.trim() !== '') {
                sections[currentSection].push(line);
            }
        });

        return {
            id: directory, // Use directory path as unique ID
            name,
            status: parseStatus(sections['Status']),
            tasks: parseTasks(sections['Tasks']),
            log: parseLog(sections['Log']),
            memory,
            docs, // List of other markdown files
            lastUpdated: mtime.getTime(),
            directory
        };
    } catch (error) {
        console.error(`Error parsing ${filePath}:`, error.message);
        return null;
    }
}

function parseStatus(lines) {
    if (!lines || lines.length === 0) return { r: '🟢', text: 'idle' }; // Default

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
    return { r: '🟢', text: 'idle' };
}

function parseTasks(lines) {
    if (!lines) return [];
    const tasks = [];

    // - [ ] Task name
    const regex = /-\s+\[([ x\/!~])\]\s*(.*)/;

    lines.forEach(line => {
        const match = line.match(regex);
        if (match) {
            let status = 'todo';
            switch (match[1]) {
                case ' ': status = 'todo'; break;
                case '/': status = 'in-progress'; break;
                case 'x': status = 'done'; break;
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
    if (path.basename(filePath) === 'PROJECT.md') {
        const directory = path.dirname(filePath);
        console.log(`Agent removed: ${directory}`);
        agents.delete(directory);
        broadcast('remove', { id: directory });
    }
}

// Debounced Update Logic
function scheduleUpdate(filePath) {
    const fileName = path.basename(filePath);
    let agentDir = path.dirname(filePath);

    // Determine target PROJECT.md path
    let projectMdPath;

    if (fileName === 'PROJECT.md') {
        projectMdPath = filePath;
    } else {
        // If another file changed, check if PROJECT.md exists in same dir
        projectMdPath = path.join(agentDir, 'PROJECT.md');
        // We can't easily check exists asynchronously inside this sync handler without callback hell
        // but fs.existsSync is fast enough for just a check, or we assume it exists if we are tracking this agent.
        // Better: just schedule an update for this directory.
    }

    // Use agentDir as key for debouncing
    if (updateQueue.has(agentDir)) {
        clearTimeout(updateQueue.get(agentDir));
    }

    // Set a new timeout (Debounce 500ms)
    const timeoutId = setTimeout(async () => {
        updateQueue.delete(agentDir); // Remove from queue when executing

        try {
            // Verify PROJECT.md exists before parsing
            // We use the derived path
            const targetProjectMd = path.join(agentDir, 'PROJECT.md');

            try {
                await fs.access(targetProjectMd); // Check existence async
            } catch (e) {
                // PROJECT.md doesn't exist, ignore this update (maybe it was deleted or just a loose md file)
                return;
            }

            console.log(`Updating agent: ${agentDir}`);
            const agent = await parseProjectMd(targetProjectMd);
            if (agent) {
                agents.set(agent.id, agent);
                broadcast('update', agent);
            }
        } catch (err) {
            console.error(`Update failed for ${agentDir}:`, err.message);
        }
    }, 500);

    updateQueue.set(agentDir, timeoutId);
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
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);

            // Respect ignores
            if (isIgnored(fullPath)) {
                continue;
            }

            if (entry.isDirectory()) {
                await scanWorkspace(fullPath);
            } else if (entry.name === 'PROJECT.md') {
                // Found an agent!
                scheduleUpdate(fullPath);
            }
        }
    } catch (e) {
        console.error(`Scan error in ${dir}:`, e.message);
    }
}

// Trigger initial scan
scanWorkspace(WORKSPACE);


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

    // 5. File Content API
    if (pathname === '/api/file') {
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

    // 6. Static Files
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

server.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
});
