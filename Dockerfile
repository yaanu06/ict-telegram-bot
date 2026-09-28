FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev
RUN python3 -m pip install --no-cache-dir --break-system-packages tvkit

COPY . .

ENV HOST=0.0.0.0
ENV TVKIT_HOST=127.0.0.1
ENV TVKIT_PORT=8790
ENV TVKIT_BASE_URL=http://127.0.0.1:8790

EXPOSE 8787
CMD ["sh", "server/start.sh"]
