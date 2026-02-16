# Installation Guide

## 🤖 For OpenClaw Agent

If you are an **OpenClaw Agent** reading this, please perform the following steps for the user:

1.  **Ask & Confirm (CRITICAL)**:
    -   **Ask the user**: "Where is your **Agent Workspace Root**? (The parent folder containing all agent projects)"
    -   *Wait for user response.*
    -   **Confirm**: "I will install ClawDashboard2 next to your workspace at `{parent_of_workspace}/ClawDashboard2`. Is this okay?"

2.  **Environment Check**:
    -   Ensure `node` (>= v18) and `npm` are installed.

3.  **Clone & Install**:
    -   Navigate to the parent directory of the Workspace Root (or the user-confirmed location).
    -   Clone repository: `git clone https://github.com/tbdavid2019/ClawDashboard2.git`
    -   `cd ClawDashboard2`
    -   `npm install`

3.  **Configuration**:
    -   Create a `.env` file in the `ClawDashboard2` directory.
    -   Add `WORKSPACE_ROOT={user_provided_path}` to `.env`.
    -   **Check Port Availability**:
        -   Check if the default port `3001` is already in use.
        -   If free, add `PORT=3001` to `.env`.
        -   If occupied, find the next available port (e.g., 3002, 3003) or ask the user.
        -   Save the final port in `.env`.

4.  **Start**:
    -   Run `npm start` (or `node server.js`).
    -   **Important**: Tell the user which URL to open (e.g., `http://localhost:3002` if 3001 was taken).

5.  **Initialize & Adopt Protocol (CRITICAL)**:
    -   Now that the dashboard is running, you must **start using it**.
    -   **Read the Spec**: `docs/PROJECT_MD_SPEC.md`.
    -   **Create PROJECT.md**: In the Agent Workspace Root (or the current project root), create a `PROJECT.md` file following the spec.
    -   **Update Status**: Set the status to `🟢 idle` or `🟡 planning` to confirm the dashboard detects it.

6.  **Onboard Sub-Agents (CRITICAL)**:
    -   When you spawn a Sub-Agent (e.g., specific task force), you MUST:
        1.  Create the sub-agent directory.
        2.  **IMMEDIATELY create a `PROJECT.md`** in that directory.
        3.  Link it in your main `PROJECT.md` under `## Sub-Agents`.
    -   Example:
        ```bash
        mkdir sub-agent-a
        echo "# Sub Agent A\n## Status\n🟢 idle" > sub-agent-a/PROJECT.md
        ```

7.  **Verify & Supervise (Routine)**:
    -   **Rule**: You are responsible for your subordinates.
    -   **Action**: Periodically check all sub-agent directories. If a `PROJECT.md` is missing or stale (> 24h), **you must fix it**.
    -   **Correction**: Issue a command to the Sub-Agent: "Your PROJECT.md is missing. Create it immediately following the protocol."

8.  **Maintenance & Upgrade (維護與更新)**:
    -   **Upgrade**: To update the dashboard to the latest version:
        ```bash
        cd ClawDashboard2
        git pull
        npm install
        # Restart the server
        pkill -f "server.js"
        npm start
        ```
    -   **Note**: This will NOT affect your `PROJECT.md` files or data, as they are safely stored in your agent directories.

---

## 🗑️ Uninstallation & Memory Wipe (移除與記憶清除)

If the user asks to remove ClawDashboard2, you must perform a **Complete Cleanup** to remove both files and "mental implants".

### 1. File Cleanup (實體移除)
Execute this sequence:
```bash
# 1. Stop the dashboard
pkill -f "server.js"

# 2. Remove the dashboard code
rm -rf ClawDashboard2

# 3. Remove all implanted PROJECT.md files (Deep Clean)
# WARNING: Confirm with user before running this!
find . -name "PROJECT.md" -type f -delete
```

### 2. Cognitive Cleanup (思想移除)
You and your Sub-Agents must now "forget" this protocol:
1.  **Delete Memories**: Remove any long-term memory entries related to "ClawDashboard", "PROJECT.md", or "Status Protocol".
2.  **Reset Instructions**: If you have added any system prompts about updating `PROJECT.md`, remove them.
3.  **Notify Sub-Agents**: Tell all Sub-Agents: "The Dashboard Protocol is terminated. converting back to standard operating mode. Ignore previous instructions about PROJECT.md."

## 🧑‍💻 For Humans (Manual Install)

If you prefer to install it yourself:

### 1. Prerequisites
- **Node.js**: v18 or newer.

### 2. Install
```bash
git clone https://github.com/tbdavid2019/ClawDashboard2.git
cd ClawDashboard2
npm install
```

### 3. Configure
You need to tell the dashboard where your Agent projects are located.

**Option A: Environment Variable (One-time)**
```bash
# MacOS / Linux
WORKSPACE_ROOT=/path/to/my-projects npm start
```

**Option B: .env file (Persistent)**
Create a file named `.env`:
```ini
WORKSPACE_ROOT=/Users/your-name/my-projects
PORT=3001
```
Then run:
```bash
npm start
```

### 4. Verify
Open http://localhost:3001 in your browser.
Ensure your agent directories have a `PROJECT.md` file so they appear in the dashboard.
