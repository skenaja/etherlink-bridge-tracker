const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ethers = require("ethers");
const { decodeInputData } = require("./ethereumDecoder");

const THIRDWEB_CLIENT_ID = "aedf18b90e9bce765fa32af4ffc94fa1";

const thirdwebFastWithdrawalLogsCacheFilePath = path.join(
  process.cwd(),
  "src",
  "data",
  "thirdwebFastWithdrawalLogsCache.json",
);

// Function to fetch and save data
async function fetchAndSaveData() {
  const cacheDuration = 3600000; // 1 hour in milliseconds
  console.log("start process-etherlink-fast-withdrawal-log-event-data.js");

  // Set up ethers provider (replace with your RPC URL)
  const RPC_URL = process.env.ETH_RPC_URL || "https://node.mainnet.etherlink.com";
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

  // FastWithdrawal event signature
  const FAST_WITHDRAWAL_TOPIC = "0x62e8e01e31b83084b97c32b1b11ad5a2042382f5f65ee4106ad4a0d0f8b9942c";
  const CONTRACT_ADDRESS = "0xff00000000000000000000000000000000000001";

  let fromBlock = 7063573; // block corresponding to timestamp 1744748222
  let allData = [];
  let highestBlock = fromBlock;

  try {
    // Check if cache file exists and read it
    if (fs.existsSync(thirdwebFastWithdrawalLogsCacheFilePath)) {
      const cacheFile = fs.readFileSync(thirdwebFastWithdrawalLogsCacheFilePath);
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
        fromBlock = cache.blockNumber + 1;
      } else if (cache.highestBlock) {
        fromBlock = cache.highestBlock + 1;
      }
    }

    // Get latest block
    const latestBlock = await provider.getBlockNumber();
    console.log(`Fetching logs from block ${fromBlock} to ${latestBlock}`);

    // Fetch logs in batches (e.g., 1000 blocks at a time), 3 batches in parallel
    const BATCH_SIZE = 1000;
    for (let start = fromBlock; start <= latestBlock; start += BATCH_SIZE * 3) {
      const batchRanges = [0, 1, 2].map(i => {
        const batchStart = start + i * BATCH_SIZE;
        const batchEnd = Math.min(batchStart + BATCH_SIZE - 1, latestBlock);
        return batchStart <= latestBlock ? { batchStart, batchEnd } : null;
      }).filter(Boolean);
      console.log(
        `Requesting logs for batches: ` +
        batchRanges.map(r => `[${r.batchStart}, ${r.batchEnd}]`).join(", ")
      );
      // Run up to 3 getLogs calls in parallel
      const logsArrays = await Promise.all(
        batchRanges.map(r =>
          provider.getLogs({
            address: CONTRACT_ADDRESS,
            fromBlock: r.batchStart,
            toBlock: r.batchEnd,
            topics: [FAST_WITHDRAWAL_TOPIC]
          })
        )
      );
      for (let idx = 0; idx < logsArrays.length; idx++) {
        const logs = logsArrays[idx];
        console.log(`Fetched ${logs.length} logs for batch ${idx + 1}`);
        for (const log of logs) {
          // Decode log using ethers
          const abi = [
            "event FastWithdrawal(bytes22 target_receiver,uint256 withdrawal_id,uint256 amount,uint256 timestamp,bytes payload,address l2_caller)"
          ];
          const iface = new ethers.utils.Interface(abi);
          let decoded;
          try {
            decoded = iface.parseLog(log);
          } catch (e) {
            console.error("Failed to decode log", e);
            continue;
          }
          const entry = {
            block_number: log.blockNumber,
            block_hash: log.blockHash,
            block_timestamp: null, // will fill below
            transaction_hash: log.transactionHash,
            target_receiver: decoded.args.target_receiver,
            withdrawal_id: decoded.args.withdrawal_id.toString(),
            amount: decoded.args.amount.toString(),
            timestamp: decoded.args.timestamp.toString(),
            payload: decoded.args.payload,
            l2_caller: decoded.args.l2_caller
          };
          // Get block timestamp (only if not already in allData)
          if (!allData.some(e => e.transaction_hash === entry.transaction_hash)) {
            const block = await provider.getBlock(log.blockNumber);
            entry.block_timestamp = block.timestamp;
            allData.push(entry);
          }
          if (log.blockNumber > highestBlock) {
            highestBlock = log.blockNumber;
          }
        }
      }
      // Save after each set of parallel getLogs calls
      const cacheAfterGetLogs = {
        timestamp: new Date().getTime(),
        blockNumber: highestBlock,
        data: allData,
      };
      fs.writeFileSync(thirdwebFastWithdrawalLogsCacheFilePath, JSON.stringify(cacheAfterGetLogs, null, 2));
    }

    console.log("Data fetched and saved successfully");
    return allData;
  } catch (error) {
    console.error("Error:", error);
  }
}

fetchAndSaveData();
