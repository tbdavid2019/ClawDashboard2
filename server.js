const http = require('http');
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');

// Configuration
const WORKSPACE = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..');
const PORT = process.env.PORT || 3001;
const IGNORED_PATHS = ['**/node_modules/**', '**/.git/**', '**/ClawDashboard2/**'];

console.log(`Starting ClawDashboard2...`);
console.log(`Watching workspace: ${WORKSPACE}`);

// State
const agents = new Map();
const clients = new Set();

// ---- 1. Markdown Parser ----
function parseProjectMd(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const mtime = fs.statSync(filePath).mtime;
        const directory = path.dirname(filePath);

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
            lastUpdated: mtime.getTime(),
            directory
        };
    } catch (error) {
        console.error(`Error parsing ${filePath}:`, error);
        return null;
    }
}

function parseStatus(lines) {
    if (!lines || lines.length === 0) return { r: '🟢', text: 'idle' }; // Default

    // Find first line with emoji or text
    for (const line of lines) {
        const match = line.match(/([🟢🔵🟡🟠🔴⏸️❌])\s*(.*)/);
        if (match) {
            return { r: match[1], text: match[2].trim() };
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
const watcher = chokidar.watch(`${WORKSPACE}/**/PROJECT.md`, {
    ignored: IGNORED_PATHS,
    depth: 2,
    persistent: true,
    awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
    }
});

watcher
    .on('add', filePath => updateAgent(filePath))
    .on('change', filePath => updateAgent(filePath))
    .on('unlink', filePath => removeAgent(filePath));

function updateAgent(filePath) {
    console.log(`Detected change: ${filePath}`);
    const agent = parseProjectMd(filePath);
    if (agent) {
        agents.set(agent.id, agent);
        broadcast('update', agent);
    }
}

function removeAgent(filePath) {
    const directory = path.dirname(filePath);
    console.log(`Agent removed: ${directory}`);
    agents.delete(directory);
    broadcast('remove', { id: directory });
}


// ---- 3. SSE & HTTP Server ----
function broadcast(event, data) {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
        res.write(message);
    }
}

const server = http.createServer((req, res) => {
    // 1. CORS for dev
    res.setHeader('Access-Control-Allow-Origin', '*');

    // 2. SSE Endpoint
    if (req.url === '/api/events') {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
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

    // 3. API Endpoint (Snapshot)
    if (req.url === '/api/agents') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(Array.from(agents.values())));
        return;
    }

    // 4. Static Files
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, content) => {
            if (err) {
                res.writeHead(500);
                res.end('Error loading index.html');
            } else {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(content);
            }
        });
        return;
    }

    res.writeHead(404);
    res.end('Not Found');
});

server.listen(PORT, () => {
    console.log(`Dashboard running at http://localhost:${PORT}`);
});
