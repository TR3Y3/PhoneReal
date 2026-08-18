const redisUrl = process.env.REDIS_URL;

let client = null;
let ready = false;

if (redisUrl) {
  const { createClient } = require('redis');
  client = createClient({ url: redisUrl });
  client.on('error', (err) => console.error('Redis error:', err.message));
  client
    .connect()
    .then(() => {
      ready = true;
      console.log('Connected to Redis cache.');
    })
    .catch((err) => console.error('Redis connect failed:', err.message));
} else {
  console.log('REDIS_URL not set — running without cache/usage tracking.');
}

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days
const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 40; // 40 days, covers a full billing month

async function getCachedResult(e164) {
  if (!ready) return null;
  try {
    const raw = await client.get(`cache:${e164}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Cache read failed:', err.message);
    return null;
  }
}

async function setCachedResult(e164, result) {
  if (!ready) return;
  try {
    await client.set(`cache:${e164}`, JSON.stringify(result), { EX: CACHE_TTL_SECONDS });
  } catch (err) {
    console.error('Cache write failed:', err.message);
  }
}

async function incrementMonthlyUsage(provider) {
  if (!ready) return null;
  try {
    const key = `usage:${provider}:${new Date().toISOString().slice(0, 7)}`;
    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, COUNTER_TTL_SECONDS);
    }
    return count;
  } catch (err) {
    console.error('Usage counter failed:', err.message);
    return null;
  }
}

async function getMonthlyUsage(provider) {
  if (!ready) return null;
  try {
    const key = `usage:${provider}:${new Date().toISOString().slice(0, 7)}`;
    const val = await client.get(key);
    return val ? parseInt(val, 10) : 0;
  } catch (err) {
    console.error('Usage read failed:', err.message);
    return null;
  }
}

module.exports = { getCachedResult, setCachedResult, incrementMonthlyUsage, getMonthlyUsage };
