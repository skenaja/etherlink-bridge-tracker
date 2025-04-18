const axios = require("axios");
const fs = require("fs");
const path = require("path");
const ethers = require("ethers");
const { decodeInputData } = require("./ethereumDecoder");

const blockscoutCacheFilePath = path.join(
  process.cwd(),
  "src",
  "data",
  "blockscoutDataCache.json",
);

// Function to fetch and save data
async function fetchAndSaveData() {
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
        console.log("Returning cached data");
        return cache.data;
      }
    }

    // If cache is not valid, fetch new data
    // TODO: this needs pagination adding at some point
    const url =
      "https://explorer.etherlink.com/api?module=account&action=txlist&address=0xff00000000000000000000000000000000000001&filter_by=to&sort=desc";
    const response = await axios.get(url);
    const data = response.data["result"];

    // Filter out records with isError = 1
    const filteredData = data.filter(tx => tx.isError === "0");

    const processedData = filteredData.map((tx) => {
      const decoded = decodeInputData(tx.input);
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

      return {
        sent: new Date(parseInt(tx.timeStamp) * 1000)
          .toISOString()
          .split("T")[0],
        from: tx.from,
        to: toAddress,
        amount: ethers.utils.formatEther(tx.value),
        hash: tx.hash,
        timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString(),
        data: tx.input,
        type: type,
      };
    });

    // Cache the new data with a timestamp
    const cache = {
      timestamp: new Date().getTime(),
      data: processedData,
    };
    fs.writeFileSync(blockscoutCacheFilePath, JSON.stringify(cache, null, 2));

    console.log("Data fetched and saved successfully");
    return processedData;
  } catch (error) {
    console.error("Error:", error);
  }
}

fetchAndSaveData();
