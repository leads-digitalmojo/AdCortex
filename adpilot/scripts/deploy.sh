#!/bin/bash

# AdPilot VPS Deployment Script
# Usage: ./scripts/deploy.sh

set -e  # Exit on error

echo "🚀 Starting AdPilot deployment..."

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Pull latest code
echo -e "${YELLOW}📦 Pulling latest code from GitHub...${NC}"
git pull origin main || { echo -e "${RED}❌ Failed to pull from GitHub${NC}"; exit 1; }

# Step 2: Install dependencies
echo -e "${YELLOW}📦 Installing dependencies...${NC}"
npm ci || { echo -e "${RED}❌ Failed to install dependencies${NC}"; exit 1; }

# Step 3: Build
echo -e "${YELLOW}🔨 Building application...${NC}"
npm run build || { echo -e "${RED}❌ Build failed${NC}"; exit 1; }

# Step 4: Restart with PM2 (or start if not yet running)
echo -e "${YELLOW}♻️  Restarting with PM2...${NC}"
if pm2 describe adpilot > /dev/null 2>&1; then
    pm2 reload ecosystem.config.cjs --env production || { echo -e "${RED}❌ Failed to reload PM2${NC}"; exit 1; }
else
    pm2 start ecosystem.config.cjs --env production || { echo -e "${RED}❌ Failed to start PM2${NC}"; exit 1; }
fi

# Step 5: Save PM2 process list
pm2 save

# Step 6: Health check
echo -e "${YELLOW}🏥 Running health check...${NC}"
sleep 2

if curl -f http://localhost:3000/api/health > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Health check passed!${NC}"
else
    echo -e "${RED}⚠️  Health check failed - check logs with: pm2 logs adpilot${NC}"
fi

echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "${YELLOW}View logs:${NC} pm2 logs adpilot"
echo -e "${YELLOW}Monitor:${NC} pm2 monit"
