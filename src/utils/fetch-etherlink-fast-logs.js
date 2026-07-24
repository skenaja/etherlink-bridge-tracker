const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ethers = require("ethers");

// FastWithdrawal event signature (topic0) emitted by the Etherlink withdrawal
// precompile. The same precompile also emits other events (e.g. a regular
// Withdrawal event) on the same address, so every log returned by the API
// must be filtered client-side on this topic - never trust a server-side
// topic filter.
const FAST_WITHDRAWAL_TOPIC = "0x62e8e01e31b83084b97c32b1b11ad5a2042382f5f65ee4106ad4a0d0f8b9942c";
const CONTRACT_ADDRESS = "0xff00000000000000000000000000000000000001";

const BLOCKSCOUT_LOGS_URL = `https://explorer.etherlink.com/api/v2/addresses/${CONTRACT_ADDRESS}/logs`;

const FAST_WITHDRAWAL_ABI = [
  "event FastWithdrawal(bytes22 target_receiver,uint256 withdrawal_id,uint256 amount,uint256 timestamp,bytes payload,address l2_caller)",
];
const iface = new ethers.utils.Interface(FAST_WITHDRAWAL_ABI);

const etherlinkFastLogsCacheFilePath = path.join(
  process.cwd(),
  "src",
  "data",
  "etherlinkFastLogsCache.json",
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeItem(item) {
  const decoded = iface.parseLog({ topics: [item.topics[0]], data: item.data });
  return {
    block_number: item.block_number,
    block_hash: item.block_hash || null,
    block_timestamp: Number(decoded.args.timestamp),
    transaction_hash: item.transaction_hash,
    target_receiver: decoded.args.target_receiver,
    withdrawal_id: decoded.args.withdrawal_id.toString(),
    amount: decoded.args.amount.toString(),
    timestamp: decoded.args.timestamp.toString(),
    payload: decoded.args.payload,
    l2_caller: decoded.args.l2_caller,
  };
}

// Function to fetch and save data
async function fetchAndSaveData() {
  const cacheDuration = 8 * 60 * 1000; // 8 minutes in milliseconds
  console.log("start fetch-etherlink-fast-logs.js");

  let allData = [];
  let cachedBlockNumber = 0;

  try {
    // Check if cache file exists and read it
    if (fs.existsSync(etherlinkFastLogsCacheFilePath)) {
      const cacheFile = fs.readFileSync(etherlinkFastLogsCacheFilePath);
      const cache = JSON.parse(cacheFile);
      const now = new Date().getTime();
      if (now - cache.timestamp < cacheDuration) {
        // Cache is still valid, return cached data
        console.log("Returning cached data");
        return cache.data;
      }
      if (cache.data && Array.isArray(cache.data)) {
        allData = cache.data;
      }
      if (cache.blockNumber) {
        cachedBlockNumber = cache.blockNumber;
      }
    }

    const existingKeys = new Set(
      allData.map((e) => `${e.transaction_hash}_${e.withdrawal_id}`),
    );

    console.log(
      cachedBlockNumber
        ? `Incremental fetch: cached blockNumber ${cachedBlockNumber}, ${allData.length} cached entries`
        : "No cache found, performing full backfill",
    );

    let highestBlock = cachedBlockNumber;
    // Entries discovered this run, in the order pages arrive (newest-first).
    // We reverse this before writing so the final file stays in the same
    // ascending block order as the legacy cache.
    const newEntriesNewestFirst = [];

    let params = null;
    let page = 0;
    let keepGoing = true;

    while (keepGoing) {
      page += 1;
      let response;
      try {
        response = await axios.get(BLOCKSCOUT_LOGS_URL, {
          params: params || undefined,
        });
      } catch (err) {
        console.error(`Error fetching page ${page}:`, err.message);
        // Simple one-shot retry after a short delay before giving up.
        await sleep(1000);
        response = await axios.get(BLOCKSCOUT_LOGS_URL, {
          params: params || undefined,
        });
      }

      const items = response.data.items || [];
      console.log(`Page ${page}: fetched ${items.length} items`);

      if (items.length === 0) {
        break;
      }

      for (const item of items) {
        if (item.topics[0] !== FAST_WITHDRAWAL_TOPIC) {
          // Not a FastWithdrawal event (e.g. the precompile's regular
          // Withdrawal event) - skip silently.
          continue;
        }

        const entry = decodeItem(item);
        const key = `${entry.transaction_hash}_${entry.withdrawal_id}`;

        if (item.block_number > highestBlock) {
          highestBlock = item.block_number;
        }

        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          newEntriesNewestFirst.push(entry);
        }
      }

      // Save progress after each page.
      const combined = allData.concat([...newEntriesNewestFirst].reverse());
      const cacheAfterPage = {
        timestamp: new Date().getTime(),
        blockNumber: highestBlock,
        data: combined,
      };
      fs.writeFileSync(
        etherlinkFastLogsCacheFilePath,
        JSON.stringify(cacheAfterPage, null, 2),
      );

      // Stop once we've reached a page that is entirely made up of blocks
      // we've already processed on a previous run (incremental fetch).
      if (
        cachedBlockNumber > 0 &&
        items.every((it) => it.block_number <= cachedBlockNumber)
      ) {
        console.log("Reached already-cached block range, stopping");
        keepGoing = false;
        break;
      }

      const nextPageParams = response.data.next_page_params;
      if (!nextPageParams) {
        console.log("No more pages, reached end of history");
        keepGoing = false;
        break;
      }
      params = nextPageParams;

      // Be polite to the explorer API.
      await sleep(150);
    }

    console.log(
      `Data fetched and saved successfully. Total entries: ${allData.concat([...newEntriesNewestFirst].reverse()).length}`,
    );
    return allData.concat([...newEntriesNewestFirst].reverse());
  } catch (error) {
    console.error("Error:", error);
  }
}

fetchAndSaveData();
