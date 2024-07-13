const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ethers = require('ethers');
const { decodeInputData } = require('./ethereumDecoder'); // Adjust the path if needed

const abiSignature = 'withdraw_base58(string)';
// Define the path to the cache file
const blockscoutCacheFilePath = path.join(process.cwd(), 'public', 'blockscoutDataCache.json');

// Function to fetch and save data
async function fetchAndSaveData() {
  const cacheDuration = 3600000; // 1 hour in milliseconds
  console.log('start process-ethereum-data.js');

  try {
    // Check if cache file exists and read it
    if (fs.existsSync(blockscoutCacheFilePath)) {
      const cacheFile = fs.readFileSync(blockscoutCacheFilePath);
      const cache = JSON.parse(cacheFile);

      const now = new Date().getTime();
      if (now - cache.timestamp < cacheDuration) {
        // Cache is still valid, return cached data
        console.log('Returning cached data');
        // console.log(cache.data);
        return cache.data;
      }
    }

    // If cache is not valid, fetch new data
    const url = 'https://explorer.etherlink.com/api?module=account&action=txlist&address=0xff00000000000000000000000000000000000001&filter_by=to&sort=desc';
    const response = await axios.get(url);
    const data = response.data['result'];
    // debug
    // console.log(data);

    const processedData = data.map((tx) => ({
      timestamp: new Date(parseInt(tx.timeStamp) * 1000).toISOString().split('T')[0],
      from: tx.from,
      to: decodeInputData(tx.input, abiSignature),
      amount: ethers.utils.formatEther(tx.value),
      hash: tx.hash,
    }));

    // Cache the new data with a timestamp
    const cache = {
      timestamp: new Date().getTime(),
      data: processedData,
    };
    fs.writeFileSync(blockscoutCacheFilePath, JSON.stringify(cache));

    console.log('Data fetched and saved successfully');
    // console.log(processedData);
    return processedData;
  } catch (error) {
    console.error('Error:', error);
  }
}

// Run the function
fetchAndSaveData();
