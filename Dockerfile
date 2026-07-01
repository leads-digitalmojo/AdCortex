# Dockerfile for AdPilot V3 (Unified Dashboard + Agents)
FROM node:20-slim

# 1. Install System Dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    python3-venv \
    build-essential \
    libffi-dev \
    libssl-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 2. Create Python virtual environment (required for Debian Bookworm / PEP 668)
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# 3. Install Python dependencies — pinned versions for reproducible builds
RUN pip install --no-cache-dir --upgrade pip setuptools wheel && \
    pip install --no-cache-dir --prefer-binary \
    "facebook-business==19.0.3" \
    "google-ads==24.1.0" \
    "requests==2.32.3" \
    "python-dotenv==1.0.1" \
    "pandas==2.2.2"

# 4. Set Workspace & copy project files
WORKDIR /app
COPY . .

# 5. Build the AdPilot Dashboard (Node.js)
WORKDIR /app/adpilot
RUN npm install
RUN npm run build

# 6. Run database migrations at build time
# (Requires DATABASE_URL build arg; skips gracefully if not provided)
RUN --mount=type=secret,id=DATABASE_URL \
    DATABASE_URL=$(cat /run/secrets/DATABASE_URL 2>/dev/null || echo "") \
    npx drizzle-kit migrate 2>/dev/null || echo "[Docker] Skipping migrations at build time (no DATABASE_URL)"

# 7. Environment & Permissions
RUN mkdir -p /app/ads_agent/data && chmod -R 777 /app/ads_agent/data

# PORT must match render.yaml (10000) — do NOT hardcode 5000 here;
# the app reads process.env.PORT at runtime.
EXPOSE 10000
ENV NODE_ENV=production

# Start the dashboard
CMD ["npm", "start"]
