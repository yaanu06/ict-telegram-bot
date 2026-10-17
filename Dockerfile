FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Keep the official Kronos source reproducible.  The repository is runtime
# code only; model weights remain in the Hugging Face cache and are never
# copied into this image or committed to Git.
ARG KRONOS_COMMIT=67b630e67f6a18c9e9be918d9b4337c960db1e9a
RUN git clone https://github.com/shiyu-coder/Kronos.git /opt/kronos \
    && cd /opt/kronos \
    && git checkout --detach "${KRONOS_COMMIT}" \
    && rm -rf .git

COPY requirements-render.txt ./
RUN python3 -m pip install --no-cache-dir --break-system-packages -r requirements-render.txt \
    && python3 -m pip install --no-cache-dir --break-system-packages tvkit

COPY . .

ENV HOST=0.0.0.0
ENV TVKIT_HOST=127.0.0.1
ENV TVKIT_PORT=8790
ENV TVKIT_BASE_URL=http://127.0.0.1:8790
ENV KRONOS_REPO_PATH=/opt/kronos
ENV KRONOS_PYTHON=python3
ENV KRONOS_DEVICE=cpu
ENV KRONOS_WARMUP=true
ENV HF_HOME=/opt/huggingface
ENV HF_HUB_DISABLE_TELEMETRY=1
ENV OMP_NUM_THREADS=2
ENV MKL_NUM_THREADS=2
ENV MALLOC_ARENA_MAX=2

EXPOSE 8787
CMD ["sh", "server/start.sh"]
