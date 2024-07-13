import axios from "axios";
import fs from "fs";
import path from "path";

import { ethers } from "ethers";
import { decodeInputData } from "../../utils/ethereumDecoder";

const abiSignature = "withdraw_base58(string)";
// Define the path to the cache file
const blockscoutCacheFilePath = path.resolve("./blockscoutDataCache.json");

export default async function handler(req, res) {
  const cacheDuration = 3600000; // 1 hour in milliseconds
  console.log("start process-ethereum-data.js");

  try {
    // Check if cache file exists and read it
    if (fs.existsSync(blockscoutCacheFilePath)) {
      const cacheFile = fs.readFileSync(blockscoutCacheFilePath);
      const cache = JSON.parse(cacheFile);

      const now = new Date().getTime();
      if (now - cache.timestamp < cacheDuration) {
        // Cache is still valid, return cached data
        return res.status(200).json(cache.data);
      }
    }

    // If cache is not valid, fetch new data
    const url =
      "https://explorer.etherlink.com/api?module=account&action=txlist&address=0xff00000000000000000000000000000000000001&filter_by=to&sort=desc";
    const response = await axios.get(url);
    const data = response.data["result"];
    //debug
    console.log(data);

    const processedData = data.map((tx) => ({
        timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString().split('T')[0],
        // blockNumber: tx.blockNumber,
      from: tx.from,
      to: decodeInputData(tx.input, abiSignature),
      amount: ethers.utils.formatEther(tx.value),
      hash: tx.hash,
    //   isError: tx.isError,
    }));

    // Cache the new data with a timestamp
    const cache = {
      timestamp: new Date().getTime(),
      data: processedData,
    };
    fs.writeFileSync(blockscoutCacheFilePath, JSON.stringify(cache));

    res.status(200).json(processedData);
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "An error occurred" });
  }
}
