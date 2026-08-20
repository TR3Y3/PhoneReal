const redisUrl = process.env.REDIS_URL;

let client = null;
let ready = false;

// The cache is an optimization, never a dependency. Any failure here — missing
// module, bad URL, unreachable host — must leave the site fully working, just
// without caching, rather than taking down phone lookups entirely.
if (redisUrl) {
  try {
    const { createClient } = require('redis');
    client = createClient({
      url: redisUrl,
      socket: {
        // Back off and eventually give up instead of retrying in a tight loop.
        reconnectStrategy: (retries) => {
          if (retries > 5) {
            console.error('Redis unreachable after 5 attempts — continuing without cache.');
            return false;
          }
          return Math.min(retries * 500, 5000);
        },
      },
    });

    let loggedError = false;
    client.on('error', (err) => {
      // One line, not one per retry.
      if (!loggedError) {
        console.error('Redis error:', err.message);
        loggedError = true;
      }
      ready = false;
    });
    client.on('ready', () => {
      ready = true;
      loggedError = false;
      console.log('Connected to Redis cache.');
    });

    client.connect().catch((err) => {
      console.error('Redis connect failed — continuing without cache:', err.message);
      ready = false;
    });
  } catch (err) {
    console.error('Redis unavailable — continuing without cache:', err.message);
    client = null;
    ready = false;
  }
} else {
  console.log('REDIS_URL not set — running without cache/usage tracking.');
}

const CACHE_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days
const COUNTER_TTL_SECONDS = 60 * 60 * 24 * 40; // 40 days, covers a full billing month

async function getCachedResult(e164) {
  if (!ready) return null;
  try {
    const raw = await client.get(`cache:v2:${e164}`);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Cache read failed:', err.message);
    return null;
  }
}

async function setCachedResult(e164, result) {
  if (!ready) return;
  try {
    await client.set(`cache:v2:${e164}`, JSON.stringify(result), { EX: CACHE_TTL_SECONDS });
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

// Cache hits are tracked separately so the savings the cache is actually
// delivering can be seen, not just guessed at.
async function incrementCacheHits() {
  if (!ready) return null;
  try {
    const key = `hits:${new Date().toISOString().slice(0, 7)}`;
    const count = await client.incr(key);
    if (count === 1) await client.expire(key, COUNTER_TTL_SECONDS);
    return count;
  } catch (err) {
    return null;
  }
}

async function getCacheHits() {
  if (!ready) return null;
  try {
    const val = await client.get(`hits:${new Date().toISOString().slice(0, 7)}`);
    return val ? parseInt(val, 10) : 0;
  } catch (err) {
    return null;
  }
}

async function countCachedNumbers() {
  if (!ready) return null;
  try {
    let total = 0;
    for await (const _ of client.scanIterator({ MATCH: 'cache:v2:*', COUNT: 200 })) total++;
    return total;
  } catch (err) {
    return null;
  }
}

function isReady() {
  return ready;
}

module.exports = {
  getCachedResult,
  setCachedResult,
  incrementMonthlyUsage,
  getMonthlyUsage,
  incrementCacheHits,
  getCacheHits,
  countCachedNumbers,
  isReady,
};
