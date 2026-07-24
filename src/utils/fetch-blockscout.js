const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ethers = require("ethers");
const { decodeInputData } = require("./ethereumDecoder");

const CONTRACT_ADDRESS = "0xff00000000000000000000000000000000000001";

// v2 REST API, paginated (unlike the old v1 etherscan-compat txlist call,
// which returned only the most recent 10,000 results with no way to page
// further back). See fetch-etherlink-fast-logs.js for the sibling
// implementation of this same pagination pattern for event logs.
const BLOCKSCOUT_TX_URL = `https://explorer.etherlink.com/api/v2/addresses/${CONTRACT_ADDRESS}/transactions`;

const blockscoutCacheFilePath = path.join(
  process.cwd(),
  "src",
  "data",
  "blockscoutDataCache.json",
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// The explorer enforces a token-bucket style rate limit (observed:
// x-ratelimit-limit 180, refilling gradually rather than resetting on a
// fixed clock boundary - a 429's `x-ratelimit-reset` can read as high as
// ~44 minutes yet the bucket is observed to partially refill again within
// a couple of minutes). A long backfill (1000+ pages) WILL hit this.
// Retry with capped exponential backoff instead of giving up, and
// self-throttle based on the remaining-budget header after every success
// so we approach (but don't cross) the limit rather than bursting into it.
const MAX_PAGE_RETRIES = 30;
const RATE_LIMIT_LOW_WATERMARK = 20; // Slow down once remaining budget drops below this.

// NOTE: the legacy cache entry shape also carried `data` (the raw input
// calldata hex, ~700 chars for fast_withdraw_base58 txs) and `extraData`
// (the decoded arg tuple). Neither is read by any consumer:
// src/pages/index.js deletes both from every item it renders (and never
// includes them at all on `matched` rows), and src/pages/all_data.js's
// fetch of this cache file is already broken independently of this change
// (it requests a public file that doesn't exist / isn't copied at build
// time, and even if it resolved, it assigns the whole {timestamp,data}
// envelope to state instead of `.data`). Both fields are dropped from the
// entry shape below (decoding still happens - we just don't persist the
// raw calldata or the decoded tuple) to keep the cache and the `/`
// page-data payload from ballooning once full 2024-onward history lands
// (tens of thousands of entries vs. today's 10k).
function processTx(tx) {
  const decoded = decodeInputData(tx.raw_input);
  let toAddress = "";
  let type = "unknown";

  if (decoded) {
    type = decoded.type;
    if (type === "withdraw_base58" || type === "fast_withdraw_base58") {
      toAddress = decoded.decodedData[0];
    } else if (type === "withdraw") {
      toAddress = ""; // Leave blank for now
    }
  }

  const isoTimestamp = new Date(tx.timestamp).toISOString();

  return {
    sent: isoTimestamp.split("T")[0],
    from: tx.from.hash,
    to: toAddress,
    amount: ethers.utils.formatEther(tx.value),
    hash: tx.hash,
    timestamp: isoTimestamp,
    type: type,
  };
}

// Fetch one page. Returns { items, next_page_params, remaining, limit,
// delayMs } where remaining/limit come from the x-ratelimit-* response
// headers (NaN if absent) and delayMs is how long the caller should wait
// before the *next* request, given the current budget.
async function fetchPage(params, attempt = 1) {
  try {
    const response = await axios.get(BLOCKSCOUT_TX_URL, {
      params: params || { filter: "to" },
    });
    const remaining = parseInt(response.headers["x-ratelimit-remaining"], 10);
    const limit = parseInt(response.headers["x-ratelimit-limit"], 10);
    const delayMs =
      !Number.isNaN(remaining) && remaining < RATE_LIMIT_LOW_WATERMARK
        ? 5000 // Budget running low - back off well before we hit a 429.
        : 200;
    return { ...response.data, remaining, limit, delayMs };
  } catch (err) {
    const status = err.response && err.response.status;
    if (attempt > MAX_PAGE_RETRIES) {
      throw err;
    }
    if (status === 429) {
      const backoffMs = Math.min(2000 * 2 ** (attempt - 1), 60000);
      console.log(
        `Rate limited (429) on attempt ${attempt}/${MAX_PAGE_RETRIES}, backing off ${backoffMs}ms`,
      );
      await sleep(backoffMs);
    } else {
      console.error(`Error fetching page (attempt ${attempt}):`, err.message);
      await sleep(2000);
    }
    return fetchPage(params, attempt + 1);
  }
}

// Function to fetch and save data
async function fetchAndSaveData() {
  const cacheDuration = 8 * 60 * 1000; // 8 minutes in milliseconds
  console.log("start fetch-blockscout.js");

  let cache = null;
  if (fs.existsSync(blockscoutCacheFilePath)) {
    try {
      cache = JSON.parse(fs.readFileSync(blockscoutCacheFilePath));
    } catch (e) {
      console.error("Failed to parse existing cache, ignoring it:", e.message);
      cache = null;
    }
  }

  // A completed backfill is the only state that has a real blockNumber
  // high-water mark. The legacy v1 cache (10k most-recent txs, no
  // blockNumber field at all) does NOT count, and per the task is to be
  // replaced wholesale by a full backfill rather than merged with - the v1
  // cache is missing OLD history, not new, so incrementally extending it
  // forward would never fill the gap back to the bridge's 2024 launch.
  const backfillComplete = !!(cache && cache.blockNumber);

  // Only trust the freshness short-circuit once a backfill has actually
  // completed. While a backfill is in progress, cache.timestamp gets
  // rewritten after every single page (to persist progress), so if we
  // honored the 8-minute window here, re-running this script shortly after
  // an interrupted backfill would just return the still-incomplete data
  // instead of resuming it.
  if (backfillComplete) {
    const now = new Date().getTime();
    if (now - cache.timestamp < cacheDuration) {
      console.log("Returning cached data");
      return cache.data;
    }
  }

  try {
    if (!backfillComplete) {
      return await runBackfill(cache);
    }
    return await runIncremental(cache);
  } catch (error) {
    console.error("Error:", error);
  }
}

// Full backfill from the newest tx back to the beginning of history.
//
// Design note on why blockNumber is NOT set until the backfill fully
// completes: pagination is newest-first, so at any partial point we only
// know "everything from the top down to page N's lowest block is captured"
// - we do NOT know the highest block yet reachable is complete, because
// there could still be no higher truth beyond what's already been seen
// (the max seen so far IS the true high-water mark, that part is fine),
// but using it as a stored "high-water mark" would be misleading: a
// consumer (in this case, our own incremental mode) uses blockNumber as
// "we have fully captured everything from this block upward", which only
// becomes true once pagination has run all the way through with no gaps.
// If we set it early and the process were killed, a later run would take
// the partial blockNumber, restart incremental mode, and stop prematurely
// as soon as it reprocessed page 1 - silently leaving a gap between the
// partial blockNumber and the true old low-water point.
//
// Instead we persist `backfillCursor` = the next_page_params to resume
// from, and only set `blockNumber` once next_page_params comes back empty
// (i.e. we've reached the true end of history). This makes an interrupted
// backfill resume from where it left off (cheap) rather than needing a
// full restart, while keeping incremental mode's invariant intact.
async function runBackfill(cache) {
  let allData = [];
  let params = null;

  if (cache && Array.isArray(cache.data)) {
    allData = cache.data;
  }
  // Cached entries don't carry block_number (kept byte-compatible with the
  // legacy shape), so if we're resuming a previously-interrupted backfill,
  // the true overall high-water mark (seen on page 1 of the *original* run,
  // long before this resumed session's pages) can't be recovered from
  // `allData` alone. Persist it separately as `backfillHighWaterSoFar` and
  // carry it forward across resumes.
  let highWaterBlock = 0;

  if (cache && cache.backfillCursor) {
    params = cache.backfillCursor;
    highWaterBlock = cache.backfillHighWaterSoFar || 0;
    console.log(
      `Resuming backfill from persisted cursor, ${allData.length} entries so far, high-water block ${highWaterBlock}`,
    );
  } else {
    allData = []; // Explicitly discard any legacy (non-backfill) cache data.
    console.log("No resumable backfill cursor found, starting full backfill from scratch");
  }

  const seenHashes = new Set(allData.map((e) => e.hash));
  // Entries discovered so far this run, in the order pages arrive
  // (newest-first). Reversed before writing so the file stays in ascending
  // order like the legacy cache.
  const newEntriesNewestFirst = [];
  let failedCount = 0;
  let page = 0;

  while (true) {
    page += 1;
    const pageData = await fetchPage(params);
    const items = pageData.items || [];

    if (items.length === 0) {
      break;
    }

    for (const tx of items) {
      // Never trust a server-side direction filter blindly - filter
      // client-side on to.hash as well.
      if (
        !tx.to ||
        !tx.to.hash ||
        tx.to.hash.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()
      ) {
        continue;
      }
      if (tx.block_number > highWaterBlock) {
        highWaterBlock = tx.block_number;
      }
      if (tx.status !== "ok") {
        failedCount += 1;
        continue;
      }
      if (seenHashes.has(tx.hash)) {
        continue;
      }
      seenHashes.add(tx.hash);
      newEntriesNewestFirst.push(processTx(tx));
    }

    const nextPageParams = pageData.next_page_params || null;

    // Persist progress after every page.
    const combined = allData.concat([...newEntriesNewestFirst].reverse());
    const cacheAfterPage = {
      timestamp: new Date().getTime(),
      blockNumber: null, // Not yet - backfill still in progress, see note above.
      backfillCursor: nextPageParams,
      backfillHighWaterSoFar: highWaterBlock,
      data: combined,
    };
    fs.writeFileSync(
      blockscoutCacheFilePath,
      JSON.stringify(cacheAfterPage, null, 2),
    );

    if (page % 50 === 0) {
      console.log(
        `Backfill progress: page ${page}, ${combined.length} entries, ${failedCount} failed txs skipped, rate-limit remaining ${pageData.remaining}/${pageData.limit}`,
      );
    }

    if (!nextPageParams) {
      console.log("Backfill complete: reached end of history");
      break;
    }
    params = nextPageParams;
    await sleep(pageData.delayMs || 200);
  }

  const finalData = allData.concat([...newEntriesNewestFirst].reverse());

  const cacheFinal = {
    timestamp: new Date().getTime(),
    blockNumber: highWaterBlock,
    backfillCursor: null,
    data: finalData,
  };
  fs.writeFileSync(blockscoutCacheFilePath, JSON.stringify(cacheFinal, null, 2));

  console.log(
    `Backfill fetched and saved successfully. Total entries: ${finalData.length}, failed txs skipped: ${failedCount}`,
  );
  return finalData;
}

async function runIncremental(cache) {
  const allData = Array.isArray(cache.data) ? cache.data : [];
  const cachedBlockNumber = cache.blockNumber;

  const existingKeys = new Set(allData.map((e) => e.hash));
  console.log(
    `Incremental fetch: cached blockNumber ${cachedBlockNumber}, ${allData.length} cached entries`,
  );

  let highestBlock = cachedBlockNumber;
  const newEntriesNewestFirst = [];
  let failedCount = 0;
  let params = { filter: "to" };
  let page = 0;

  while (true) {
    page += 1;
    const pageData = await fetchPage(params);
    const items = pageData.items || [];
    console.log(`Page ${page}: fetched ${items.length} items`);

    if (items.length === 0) {
      break;
    }

    for (const tx of items) {
      if (
        !tx.to ||
        !tx.to.hash ||
        tx.to.hash.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()
      ) {
        continue;
      }
      if (tx.block_number > highestBlock) {
        highestBlock = tx.block_number;
      }
      if (tx.status !== "ok") {
        failedCount += 1;
        continue;
      }
      if (!existingKeys.has(tx.hash)) {
        existingKeys.add(tx.hash);
        newEntriesNewestFirst.push(processTx(tx));
      }
    }

    const combined = allData.concat([...newEntriesNewestFirst].reverse());
    const cacheAfterPage = {
      timestamp: new Date().getTime(),
      blockNumber: highestBlock,
      backfillCursor: null,
      data: combined,
    };
    fs.writeFileSync(
      blockscoutCacheFilePath,
      JSON.stringify(cacheAfterPage, null, 2),
    );

    if (
      cachedBlockNumber > 0 &&
      items.every((it) => it.block_number <= cachedBlockNumber)
    ) {
      console.log("Reached already-cached block range, stopping");
      break;
    }

    const nextPageParams = pageData.next_page_params || null;
    if (!nextPageParams) {
      console.log("No more pages, reached end of history");
      break;
    }
    params = nextPageParams;
    await sleep(pageData.delayMs || 200);
  }

  const finalData = allData.concat([...newEntriesNewestFirst].reverse());
  console.log(
    `Incremental fetch complete. Total entries: ${finalData.length}, failed txs skipped: ${failedCount}`,
  );
  return finalData;
}

fetchAndSaveData();
