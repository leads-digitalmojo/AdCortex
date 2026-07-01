# VPS Deployment Guide

## Overview
AdPilot is deployed on a VPS using Node.js with PM2 process manager.

## Prerequisites
- Node.js 18+ installed
- PM2 installed globally: `npm install -g pm2`
- Git access to the repository
- PostgreSQL database running
- Environment variables configured

## Initial Setup (One-time)

### 1. Clone the repository
```bash
cd /home/ubuntu/apps  # or your preferred directory
git clone https://github.com/leads-digitalmojo/AdCortex.git
cd AdCortex/adpilot
```

### 2. Install dependencies
```bash
npm ci  # use ci for production (cleaner than install)
```

### 3. Set up environment variables
```bash
cp .env.example .env  # or create from scratch
# Edit .env with your production values:
# - DATABASE_URL
# - API keys (Google, Meta, Anthropic, etc.)
# - AUTH credentials
```

### 4. Build the application
```bash
npm run build
```

### 5. Start with PM2
```bash
pm2 start ecosystem.config.js --env production
pm2 save  # save PM2 process list
```

## Deployment Process (After code changes)

### Option 1: Manual Deployment (Recommended for testing)
```bash
cd /path/to/AdCortex/adpilot
git pull origin main
npm ci
npm run build
pm2 restart adpilot --env production
```

### Option 2: Automated Deployment (GitHub Actions)
Set up a GitHub Actions workflow to auto-deploy on push to `main` branch. See `.github/workflows/deploy.yml` for details.

## PM2 Management

### View running processes
```bash
pm2 list
```

### View logs
```bash
pm2 logs adpilot
```

### Restart the app
```bash
pm2 restart adpilot
```

### Stop the app
```bash
pm2 stop adpilot
```

### Start the app
```bash
pm2 start adpilot
```

### Reload with zero downtime
```bash
pm2 reload adpilot
```

## Environment Variables

Required environment variables in production:

```
NODE_ENV=production
PORT=3000  # or your preferred port
DATABASE_URL=postgresql://...
SESSION_SECRET=<generate-secure-random>

# Google Ads API
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
GOOGLE_DEVELOPER_TOKEN=...
GOOGLE_MCC_ID=...
GOOGLE_CUSTOMER_ID=...

# Meta (Facebook) Ads API
META_ACCESS_TOKEN=...
META_AD_ACCOUNT_ID=...

# Claude/Anthropic API
ANTHROPIC_API_KEY=...

# Additional APIs
OPENAPI_API_KEY=...
GROQ_API_KEY=...

# Bootstrap credentials (for first login)
AUTH_BOOTSTRAP_EMAIL=...
AUTH_BOOTSTRAP_PASSWORD=...
```

## Health Checks

The app exposes a health check endpoint:
```bash
curl https://your-domain.com/api/health
```

Monitor this endpoint to ensure the app is running properly.

## Database Migrations

Migrations run automatically on startup. If manual migration is needed:
```bash
npm run db:push
```

## Troubleshooting

### App won't start
```bash
# Check logs
pm2 logs adpilot --err

# Check if port is in use
lsof -i :3000

# Check environment variables
pm2 env adpilot
```

### High memory usage
```bash
# Restart to clear memory
pm2 restart adpilot

# Monitor memory
pm2 monit
```

### Database connection issues
- Verify `DATABASE_URL` is correct
- Check database is running and accessible from VPS
- Check firewall/security groups allow the connection

## Monitoring

Enable PM2 monitoring:
```bash
pm2 install pm2-auto-pull  # auto-pull from git on new commits
pm2 install pm2-logrotate  # rotate logs to prevent disk overflow
```

## Nginx/Reverse Proxy Setup

Example Nginx configuration:
```nginx
server {
    listen 80;
    server_name adcortex.digitalmojo.in;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Then restart Nginx:
```bash
sudo systemctl restart nginx
```

## Rollback

If deployment fails, rollback to previous version:
```bash
cd /path/to/AdCortex/adpilot
git revert HEAD
git push origin main
# Or manually checkout previous commit:
# git checkout <commit-hash>

npm ci
npm run build
pm2 restart adpilot
```

## Deployment Checklist

- [ ] Code pushed to `main` branch
- [ ] Environment variables updated if needed
- [ ] Database migrations completed (automatic)
- [ ] Build succeeds locally: `npm run build`
- [ ] PM2 process restarted: `pm2 restart adpilot`
- [ ] Health check passes: `/api/health`
- [ ] Monitor logs for errors: `pm2 logs adpilot`
- [ ] Test critical features in production
