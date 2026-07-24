const axios = require("axios");
const fs = require("fs");
const path = require("path");

const cacheFilePath = path.join(
  process.cwd(),
  "src",
  "data",
  "tzktFastEventsCache.json",
);

// Fast-withdrawal contracts on Tezos mainnet. Both are queried together since
// TzKT contract events share one global, monotonically increasing id space
// across contracts, so a single `lastId` watermark is sufficient for
// incremental fetches (verified against live API: `id.gt` + `sort.asc=id`
// walks a single ordered stream regardless of how many contracts are listed
// in `contract.in`).
//
// Note: KT1TczPwz5KjAuuJKvkTmttS7bBioT5gjQ4Y currently has zero events (and
// zero operations/no account record at all) according to TzKT - see the
// investigation notes in the PR/report for this script. It's kept in the
// list for forward compatibility in case it's ever (re)activated.
const CONTRACTS = [
  "KT1BGwyCrnJ6HuEYP7X8Q2UooTdxmEYHiK6j",
  "KT1TczPwz5KjAuuJKvkTmttS7bBioT5gjQ4Y",
];

const EVENTS_URL = "https://api.tzkt.io/v1/contracts/events";
const OPERATIONS_URL = "https://api.tzkt.io/v1/operations/transactions";

const EVENTS_PAGE_LIMIT = 10000; // TzKT's max `limit` for this endpoint
const HASH_BATCH_SIZE = 100; // ids per operations/transactions lookup

// Build a flat cache entry from a raw TzKT contract event.
function buildEntry(event, hash) {
  const withdrawal = (event.payload && event.payload.withdrawal) || {};

  const entry = {
    tag: event.tag,
    contract: (event.contract && event.contract.address) || "",
    event_id: event.id,
    level: event.level,
    event_timestamp: event.timestamp,
    hash: hash || "",
    withdrawal_id:
      withdrawal.withdrawal_id != null ? String(withdrawal.withdrawal_id) : "",
    full_amount:
      withdrawal.full_amount != null ? String(withdrawal.full_amount) : "",
    ticketer: withdrawal.ticketer || "",
    base_withdrawer: withdrawal.base_withdrawer || "",
    l2_address: withdrawal.l2_caller
      ? `0x${withdrawal.l2_caller.toLowerCase()}`
      : "",
    payload: withdrawal.payload || "",
    withdrawal_timestamp: withdrawal.timestamp || "",
    amount:
      withdrawal.full_amount != null
        ? parseFloat(withdrawal.full_amount) / 1e6
        : 0,
  };

  if (event.tag === "payout_withdrawal") {
    entry.payout_amount =
      event.payload && event.payload.payout_amount != null
        ? String(event.payload.payout_amount)
        : "";
    entry.service_provider = (event.payload && event.payload.service_provider) || "";
  } else if (event.tag === "settle_withdrawal") {
    entry.receiver = (event.payload && event.payload.receiver) || "";
  }

  return entry;
}

// Fetch one page of payout_withdrawal / settle_withdrawal events with id > lastId.
async function fetchEventsPage(lastId) {
  const response = await axios.get(EVENTS_URL, {
    params: {
      "contract.in": CONTRACTS.join(","),
      "tag.in": "payout_withdrawal,settle_withdrawal",
      "id.gt": lastId,
      "sort.asc": "id",
      limit: EVENTS_PAGE_LIMIT,
    },
  });
  return response.data;
}

// Resolve TzKT transactionId -> operation hash in batches, so the UI can
// link out to an explorer. Events only carry `transactionId`, not `hash`.
async function resolveHashes(transactionIds) {
  const uniqueIds = Array.from(new Set(transactionIds));
  const hashMap = {};

  for (let i = 0; i < uniqueIds.length; i += HASH_BATCH_SIZE) {
    const batch = uniqueIds.slice(i, i + HASH_BATCH_SIZE);
    const response = await axios.get(OPERATIONS_URL, {
      params: {
        "id.in": batch.join(","),
        select: "id,hash",
      },
    });
    for (const row of response.data) {
      hashMap[row.id] = row.hash;
    }
  }

  return hashMap;
}

async function fetchAndSaveData() {
  const cacheDuration = 8 * 60 * 1000; // 8 minutes in milliseconds

  let allData = [];
  let lastId = 0;

  try {
    // Check if cache file exists and read it
    if (fs.existsSync(cacheFilePath)) {
      const cacheFile = fs.readFileSync(cacheFilePath);
      const cache = JSON.parse(cacheFile);

      const now = new Date().getTime();
      if (now - cache.timestamp < cacheDuration) {
        // Cache is still valid, return cached data
        console.log("Returning cached data");
        return cache.data;
      }

      if (Array.isArray(cache.data)) {
        allData = cache.data;
      }
      if (typeof cache.lastId === "number") {
        lastId = cache.lastId;
      }
    }

    let hasMoreData = true;
    while (hasMoreData) {
      const events = await fetchEventsPage(lastId);

      if (events.length > 0) {
        // Only resolve hashes for the events we just fetched - previously
        // cached entries already carry their resolved hash.
        const transactionIds = events.map((event) => event.transactionId);
        const hashMap = await resolveHashes(transactionIds);

        const processedData = events.map((event) =>
          buildEntry(event, hashMap[event.transactionId]),
        );
        allData = allData.concat(processedData);

        // Update lastId for the next iteration/incremental run
        lastId = events[events.length - 1].id;

        console.log(
          `Fetched ${events.length} events (up to id ${lastId}); total so far: ${allData.length}`,
        );

        if (events.length < EVENTS_PAGE_LIMIT) {
          // Short page means we've reached the end
          hasMoreData = false;
        }
      } else {
        // No more data to fetch
        hasMoreData = false;
      }
    }

    // Cache the new data with a timestamp
    const cache = {
      timestamp: new Date().getTime(),
      lastId,
      data: allData,
    };
    fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2));

    console.log("Data fetched and saved successfully");
    console.log(`Total events cached: ${allData.length}`);
    return allData;
  } catch (error) {
    console.error("Error:", error);
  }
}

fetchAndSaveData();
