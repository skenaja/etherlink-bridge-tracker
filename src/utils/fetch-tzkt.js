const axios = require("axios");
const fs = require("fs");
const path = require("path");

const cacheFilePath = path.join(
  process.cwd(),
  "src",
  "data",
  "tzktDataCache.json",
);

const fastEventsCacheFilePath = path.join(
  process.cwd(),
  "src",
  "data",
  "tzktFastEventsCache.json",
);

function loadFastSettlementKeys() {
  const keys = new Set();

  if (!fs.existsSync(fastEventsCacheFilePath)) {
    console.warn(
      "tzktFastEventsCache.json not found; skipping fast withdrawal filtering",
    );
    return keys;
  }

  try {
    const fastEventsFile = fs.readFileSync(fastEventsCacheFilePath);
    const fastEventsCache = JSON.parse(fastEventsFile);

    for (const event of fastEventsCache.data || []) {
      if (event.tag === "settle_withdrawal") {
        keys.add(`${event.hash}|${event.receiver}|${event.full_amount}`);
      }
    }
  } catch (error) {
    console.warn(
      "Unable to parse tzktFastEventsCache.json; skipping fast withdrawal filtering",
      error,
    );
    keys.clear();
  }

  return keys;
}

async function fetchAndSaveData() {
  const cacheDuration = 8 * 60 * 1000; // 8 minutes in milliseconds

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
    }

    // Define the base URL for the API call
    const baseUrl =
      "https://api.tzkt.io/v1/accounts/KT1CeFqjJRJPNVvhvznQrWfHad2jCiDZ6Lyj/operations?sort.desc=level&sender=KT1CeFqjJRJPNVvhvznQrWfHad2jCiDZ6Lyj&entrypoint.null";
    let lastId = null; // Initialize lastId for pagination
    let allData = []; // Array to collect all pages of data
    let excludedFastCount = 0; // Count of fast-withdrawal settlements filtered out

    const fastSettlementKeys = loadFastSettlementKeys();

    try {
      let hasMoreData = true; // Flag to control the loop

      while (hasMoreData) {
        // Construct the URL with pagination if lastId is available
        const urlWithPagination = lastId
          ? `${baseUrl}&lastId=${lastId}`
          : baseUrl;
        const response = await axios.get(urlWithPagination);
        const data = response.data;

        if (data.length > 0) {
          // Filter out fast-withdrawal settlements (identified by matching
          // hash + receiver + amount, compared in raw mutez, against the
          // settle_withdrawal events cache) before they reach the slow
          // withdrawal reconciliation data
          const filteredData = data.filter((item) => {
            const key = `${item.hash}|${item.target?.address}|${item.amount}`;
            if (fastSettlementKeys.has(key)) {
              excludedFastCount += 1;
              return false;
            }
            return true;
          });

          // Process and add the fetched data to the allData array
          const processedData = filteredData.map((item) => ({
            received: item.timestamp.split("T")[0],
            to: item.target?.address || "",
            amount: parseFloat(item.amount) / 1e6,
            hash: item.hash,
            timestamp: new Date(item.timestamp).toISOString(),
          }));
          allData = allData.concat(processedData);

          // Update lastId for the next iteration
          lastId = data[data.length - 1].id;
        } else {
          // No more data to fetch
          hasMoreData = false;
        }
      }

      // Cache the new data with a timestamp
      const cache = {
        timestamp: new Date().getTime(),
        data: allData,
      };
      fs.writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2));

      console.log(
        `Excluded ${excludedFastCount} fast withdrawal settlement(s) from tzkt data`,
      );
      console.log("Data fetched and saved successfully");
      return allData;
    } catch (error) {
      console.error("Error while fetching data:", error);
    }
  } catch (error) {
    console.error("Error:", error);
  }
}

fetchAndSaveData();
