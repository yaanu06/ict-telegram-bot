// Rate limit implementation
let lastApiCallTime = 0;
let apiQueue = [];
let isProcessingQueue = false;

function rateLimitedFetch(url, options = {}, timeout = 10000) {
    return new Promise((resolve, reject) => {
        apiQueue.push({ url, options, resolve, reject, timeout });
        processApiQueue();
    });
}

async function processApiQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;
    while (apiQueue.length > 0) {
        const { url, options, resolve, reject, timeout } = apiQueue[0];
        const now = Date.now();
        const timeSinceLastCall = now - lastApiCallTime;
        if (timeSinceLastCall < 1000) {
            await new Promise(r => setTimeout(r, 1000 - timeSinceLastCall));
        }
        try {
            lastApiCallTime = Date.now();
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);

            // TwelveData rate limit check
            if (response.status === 429) {
                lastApiCallTime = Date.now() + 60000;
                continue; // Retry without shifting
            }

            // We need to also clone response to check json body if status is 200 but code is 429
            const clone = response.clone();
            try {
                const data = await clone.json();
                if (data.code === 429) {
                    lastApiCallTime = Date.now() + 60000;
                    continue; // Retry
                }
            } catch(e) {}

            apiQueue.shift();
            resolve(response);
        } catch (error) {
            apiQueue.shift();
            reject(error);
        }
    }
    isProcessingQueue = false;
}
