const axios = require("axios");
const fs = require("fs");
const path = require("path");

const cacheFilePath = path.join(
  process.cwd(),
  "src",
  "data",
  "tzktDataCache_fastWithdrawals.json",
);

async function fetchAndSaveData() {
  const cacheDuration = 3600000; // 1 hour in milliseconds

  // Abstract out the KT1 account addresses
  const accounts = [
    "KT1BGwyCrnJ6HuEYP7X8Q2UooTdxmEYHiK6j",
    "KT1TczPwz5KjAuuJKvkTmttS7bBioT5gjQ4Y"
  ];

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

    let allData = [];
    for (const account of accounts) {
      const baseUrl =
        `https://api.tzkt.io/v1/accounts/${account}/operations?sort.desc=level&entrypoint=payout_withdrawal&type=transaction`;
      let lastId = null; // Initialize lastId for pagination
      let hasMoreData = true;
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
            received: item.timestamp.split("T")[0],
            to: item.parameter?.value?.withdrawal?.base_withdrawer || "",
            amount: parseFloat(item.amount) / 1e6,
            hash: item.hash,
            timestamp: new Date(item.timestamp).toISOString(),
            withdrawal_id: item.parameter?.value?.withdrawal?.withdrawal_id || "",
            l2_address: item.parameter?.value?.withdrawal?.l2_caller ? `0x${item.parameter.value.withdrawal.l2_caller}` : "", 
            original_amount: parseFloat(item.parameter?.value?.withdrawal?.full_amount) / 1e6 || 0,
            account: account
          }));
          allData = allData.concat(processedData);

          // Update lastId for the next iteration
          lastId = data[data.length - 1].id;
        } else {
          // No more data to fetch
          hasMoreData = false;
        }
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
    console.error("Error:", error);
  }
}

fetchAndSaveData();
