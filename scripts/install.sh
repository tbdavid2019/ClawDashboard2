#!/bin/bash
set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🐾 Installing ClawDashboard2...${NC}"

# 1. Check Pre-requisites
echo -e "${BLUE}checking dependencies...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed.${NC}"
    exit 1
fi

if ! command -v git &> /dev/null; then
    echo -e "${RED}Error: git is not installed.${NC}"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo -e "${RED}Error: npm is not installed.${NC}"
    exit 1
fi

# Install pm2 if missing
if ! command -v pm2 &> /dev/null; then
    echo -e "${BLUE}Installing PM2...${NC}"
    npm install -g pm2
fi

# 2. Determine Install Location
# If running mainly from curl, we might be anywhere.
# But we assume the user wants it in their current project root or specific place.
# For simplicity, we assume we are running this in the parent of where we want to install,
# OR we are already inside the repo.

DIR_NAME="ClawDashboard2"
REPO_URL="https://github.com/tbdavid2019/ClawDashboard2.git"

if [ -d "$DIR_NAME" ]; then
    echo -e "${BLUE}Updating existing installation in $DIR_NAME...${NC}"
    cd "$DIR_NAME"
    git pull
else
    if [ -d ".git" ] && [ "$(basename "$PWD")" == "$DIR_NAME" ]; then
        echo -e "${BLUE}Already inside $DIR_NAME, pulling updates...${NC}"
        git pull
    else
        echo -e "${BLUE}Cloning into $DIR_NAME...${NC}"
        git clone "$REPO_URL"
        cd "$DIR_NAME"
    fi
fi

# 3. Install Dependencies
echo -e "${BLUE}Installing npm dependencies...${NC}"
npm install --production --silent

# 4. Setup PM2
echo -e "${BLUE}Starting with PM2...${NC}"
pm2 start ecosystem.config.js
pm2 save

# 5. Initialize Main Agent PROJECT.md if missing
# Assuming workspace root is one level up
WORKSPACE_ROOT=".."
MAIN_AGENT_DIR="$WORKSPACE_ROOT/clawd"
PROJECT_MD="$MAIN_AGENT_DIR/PROJECT.md"

if [ ! -d "$MAIN_AGENT_DIR" ]; then
     # Try to guess main agent dir or just skip
     echo -e "${BLUE}Main agent directory (clawd) not found, skipping PROJECT.md init.${NC}"
else
    if [ ! -f "$PROJECT_MD" ]; then
        echo -e "${BLUE}Initializing PROJECT.md for main agent...${NC}"
        cat > "$PROJECT_MD" <<EOF
# Project Status

## Status
🟢 idle — 待命中

## Tasks
- [ ] Awaiting instructions

## Log
- $(date +%Y-%m-%d) Workstation initialized.
EOF
    fi
fi

echo -e "${GREEN}✅ Installation Complete!${NC}"
echo -e "Dashboard is running at: http://localhost:3002"
