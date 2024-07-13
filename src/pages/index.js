import React, { useState, useEffect } from "react";
import DataDisplay from "../components/DataDisplay";

import tzktDataCache from "../data/tzktDataCache.json";
import blockscoutDataCache from "../data/blockscoutDataCache.json";

export async function getStaticProps() {

  return {
    props: {
      tzktData: tzktDataCache.data,
      blockscoutData: blockscoutDataCache.data,
      tzktTimestamp: tzktDataCache.timestamp,
      blockscoutTimestamp: blockscoutDataCache.timestamp,
    },
  };
}

function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return date
    .toISOString()
    .replace(/:\d{2}\.\d{3}Z$/, "")
    .replace("T", " ");
}

function reconcileData(tzktData, blockscoutData) {
  const currentDate = new Date();
  const sortedTzktData = [...tzktData].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );
  const sortedBlockscoutData = [...blockscoutData].sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );

  const matched = [];
  const unmatched = [];
  const notReady = [];

  const tzktByAddress = groupByAddress(sortedTzktData);
  const blockscoutByAddress = groupByAddress(sortedBlockscoutData);

  const allAddresses = new Set([
    ...Object.keys(tzktByAddress),
    ...Object.keys(blockscoutByAddress),
  ]);
  console.log("count of all addresses", allAddresses.size);

  allAddresses.forEach((address) => {
    const tzktQueue = tzktByAddress[address] || [];
    const blockscoutQueue = blockscoutByAddress[address] || [];

    while (blockscoutQueue.length > 0) {
      const blockscoutItem = blockscoutQueue.shift();
      const blockscoutDaysSinceTransaction = calculateDayDifference(
        blockscoutItem.timestamp,
        currentDate,
      );

      if (blockscoutDaysSinceTransaction < 14) {
        notReady.push({ ...blockscoutItem, source: "etherlink" });
        continue;
      }

      let matchFound = false;

      for (let i = 0; i < tzktQueue.length; i++) {
        const tzktItem = tzktQueue[i];
        const dayDifference = calculateDayDifference(
          tzktItem.timestamp,
          blockscoutItem.timestamp,
        );

        if (
          parseFloat(tzktItem.amount) === parseFloat(blockscoutItem.amount) &&
          dayDifference >= 14 &&
          dayDifference <= 60
        ) {
          matched.push({
            from: blockscoutItem.from,
            to: address,
            amount: tzktItem.amount,
            sent: blockscoutItem.timestamp,
            received: tzktItem.timestamp,
            duration: `${dayDifference} days`,
            tezosTx: tzktItem.hash,
            etherlinkTx: blockscoutItem.hash,
          });
          tzktQueue.splice(i, 1);
          matchFound = true;
          break;
        }
      }

      if (!matchFound) {
        unmatched.push({ ...blockscoutItem, source: "etherlink" });
      }
    }

    // Process remaining TzKT items
    tzktQueue.forEach((tzktItem) => {
      const tzktDaysSinceTransaction = calculateDayDifference(
        tzktItem.timestamp,
        currentDate,
      );
      if (tzktDaysSinceTransaction < 14) {
        notReady.push({ ...tzktItem, source: "tezos" });
      } else {
        unmatched.push({ ...tzktItem, source: "tezos" });
      }
    });
  });

  // sort matched based on descending order of received timestamp
  const sortedMatched = matched.sort(
    (a, b) => new Date(b.received) - new Date(a.received),
  );

  // Sort unmatched entries in ascending date order
  const sortedUnmatched = unmatched.sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );
  // Sort notReady entries in ascending date order
  const sortedNotReady = notReady.sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp),
  );

  return {
    matched: sortedMatched,
    unmatched: sortedUnmatched,
    notReady: sortedNotReady,
  };
};

function groupByAddress(data) {
  return data.reduce((acc, item) => {
    const address = item.to || item.target_address;
    if (!acc[address]) {
      acc[address] = [];
    }
    acc[address].push(item);
    return acc;
  }, {});
}

function calculateDayDifference(date1, date2) {
  const diffTime = Math.abs(new Date(date2) - new Date(date1));
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export default function ReconcilePage({
  tzktData,
  blockscoutData,
  blockscoutTimestamp,
  tzktTimestamp,
}) {
  const [reconciled, setReconciled] = useState({
    matched: [],
    unmatched: [],
    notReady: [],
  });
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const result = reconcileData(tzktData, blockscoutData);
    setReconciled(result);
  }, [tzktData, blockscoutData]);

  // Calculate sum of amounts and count of items for matched, unmatched & notReady
  const matchedSum = reconciled.matched.reduce((acc, item) => acc + parseFloat(item.amount), 0);
  const unmatchedSum = reconciled.unmatched.reduce((acc, item) => acc + parseFloat(item.amount), 0);
  const notReadySum = reconciled.notReady.reduce((acc, item) => acc + parseFloat(item.amount), 0);
  const totalSum = matchedSum + unmatchedSum + notReadySum;
  const tzktAmountSum = tzktData.reduce((acc, item) => acc + parseFloat(item.amount), 0);
  const blockscoutAmountSum = blockscoutData.reduce((acc, item) => acc + parseFloat(item.amount), 0);

  const matchedCount = reconciled.matched.length;
  const unmatchedCount = reconciled.unmatched.length;
  const notReadyCount = reconciled.notReady.length;
  const totalCount = matchedCount + unmatchedCount + notReadyCount;
  const tzktCount = tzktData.length;
  const blockscoutCount = blockscoutData.length;

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold mb-8">
        Etherlink Mainnet Bridge Withdrawals Tracker
      </h1>
      <div className="mb-4 border border-gray-300 p-4">
        <h2 className="text-2xl font-bold bg-gradient-to-r bg-clip-text text-transparent from-red-500 via-magenta-500 to-yellow-500 animate-text">
          ALL BRIDGE WITHDRAWALS TAKE AT LEAST 14 DAYS TO PROCESS. PLEASE BE PATIENT.
        </h2>
      </div>
      {/* Display sum of amounts and count of items */}
      <div className="mb-4 border border-gray-300 p-4">
        <p>Amounts: 
          matched: {matchedSum.toFixed(2)} | 
          unmatched: {unmatchedSum.toFixed(2)} |
          notReady: {notReadySum.toFixed(2)} |
          total: {totalSum.toFixed(2)} |
          tzkt: {tzktAmountSum.toFixed(2)} |
          blockscout: {blockscoutAmountSum.toFixed(2)}
        </p>
        <p>Counts: 
          matched: {matchedCount} |
          unmatched: {unmatchedCount} |
          notReady: {notReadyCount} |
          total: {totalCount} |
          tzkt: {tzktCount} |
          blockscout: {blockscoutCount}
        </p>
      </div>
      <input
        type="text"
        placeholder="Type to filter..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="mb-4 p-2 border border-gray-300"
      />

      <DataDisplay
        data={reconciled.matched}
        title="&#x2705; Transferred"
        searchTerm={searchTerm}
        hashBaseUrl=""
      />
      <DataDisplay
        data={reconciled.unmatched}
        title="&#x2757; Ready but Temporarily Stuck"
        searchTerm={searchTerm}
        hashBaseUrl=""
      />
      <DataDisplay
        data={reconciled.notReady}
        title="&#x1F4A4; Not Ready - transfer was less than 14 days ago"
        searchTerm={searchTerm}
        hashBaseUrl=""
      />
      <hr className="mb-2 mt-8" />
      <p className="mb-4 text-xs">
        BETA WARNING: Data might be wrong or out of date. Updated hourly: &nbsp;
        {formatTimestamp(blockscoutTimestamp)} UTC (Etherlink)&nbsp;
        {formatTimestamp(tzktTimestamp)} UTC (Tezos)&nbsp;
      </p>
      <p className="mb-4 text-xs">Source: Etherlink Explorer, TzKT API</p>
      <p className="mb-4 text-xs">
        Community tool by <a href="https://twitter.com/bors___">bors__nft</a> tz1fb6jz7rh4H7AojLShvhiXKaSNDyvkH7sM | 0x4fb30f8cce1f80fc9cc45f7f626069be7549af59
        
      </p>

    </div>
  );
}
