const axios = require("axios");
const fs = require("fs");
const path = require("path");

const cacheFilePath = path.join(
  process.cwd(),
  "src",
  "data",
  "tzktDataCache.json",
);

async function fetchAndSaveData() {
  const cacheDuration = 3600000; // 1 hour in milliseconds

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
          // Process and add the fetched data to the allData array
          const processedData = data.map((item) => ({
            timestamp: item.timestamp.split("T")[0],
            to: item.target?.address || "",
            amount: parseFloat(item.amount) / 1e6,
            hash: item.hash,
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
