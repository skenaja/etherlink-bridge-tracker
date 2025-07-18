import React, { useState, useEffect } from "react";
import DataDisplay from "../components/DataDisplay";
import TipJarButton from '../components/TipJarButton';

import thirdwebDataCache from "../data/thirdwebFastWithdrawalLogsCache.json";
import blockscoutDataCache from "../data/blockscoutDataCache.json";
import tzktFastDataCache from "../data/tzktDataCache_fastWithdrawals.json";

export async function getStaticProps() {
  return {
    props: {
      thirdwebData: thirdwebDataCache.data,
      blockscoutData: blockscoutDataCache.data,
      tzktFastData: tzktFastDataCache.data,
      thirdwebTimestamp: thirdwebDataCache.timestamp,
      blockscoutTimestamp: blockscoutDataCache.timestamp,
      tzktFastTimestamp: tzktFastDataCache.timestamp,
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

function reconcileFastData(blockscoutData, thirdwebData, tzktFastData) {
  // Only include blockscout entries with type: "fast_withdraw_base58"
  const filteredBlockscout = blockscoutData.filter(item => item.type === "fast_withdraw_base58");

  // 1. Match blockscout to thirdweb by transaction_hash (left outer join)
  const thirdwebByHash = Object.fromEntries(
    thirdwebData.map(item => [item.transaction_hash, item])
  );
  const blockscoutMatched = [];
  const blockscoutOnly = [];
  filteredBlockscout.forEach(item => {
    if (thirdwebByHash[item.hash]) {
      blockscoutMatched.push({ ...item, thirdweb: thirdwebByHash[item.hash] });
    } else {
      blockscoutOnly.push(item);
    }
  });

  // 2. Match thirdweb to tzktFast by withdrawal_id (full outer join style)
  const tzktByWithdrawalId = Object.fromEntries(
    tzktFastData.map(item => [item.withdrawal_id, item])
  );
  const thirdwebMatched = [];
  const thirdwebOnly = [];
  const tzktOnly = [];
  const matchedIds = new Set();

  thirdwebData.forEach(item => {
    const withdrawalId = item.withdrawal_id || item.withdrawalId;
    if (tzktByWithdrawalId[withdrawalId]) {
      thirdwebMatched.push({ ...item, tzkt: tzktByWithdrawalId[withdrawalId] });
      matchedIds.add(withdrawalId);
    } else {
      thirdwebOnly.push(item);
    }
  });
  tzktFastData.forEach(item => {
    if (!matchedIds.has(item.withdrawal_id)) {
      tzktOnly.push(item);
    }
  });

  return {
    blockscoutOnly,
    thirdwebOnly,
    tzktOnly,
    matched: thirdwebMatched,
  };
}

export default function FastWithdrawalsPage({
  thirdwebData,
  blockscoutData,
  tzktFastData,
  thirdwebTimestamp,
  blockscoutTimestamp,
  tzktFastTimestamp,
}) {
  const [reconciled, setReconciled] = useState({
    blockscoutOnly: [],
    thirdwebOnly: [],
    tzktOnly: [],
    matched: [],
  });
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    const result = reconcileFastData(blockscoutData, thirdwebData, tzktFastData);
    setReconciled(result);
    // Print withdrawal_id for thirdwebOnly
    if (result.thirdwebOnly && result.thirdwebOnly.length > 0) {
      console.log('Thirdweb Only withdrawal_ids:', result.thirdwebOnly.map(item => item.withdrawal_id || item.withdrawalId));
    }
  }, [blockscoutData, thirdwebData, tzktFastData]);

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-4xl font-bold">
          Etherlink Mainnet Fast Withdrawals Tracker
        </h1>
        <div className="w-1/4 p-4 rounded-lg bg-gradient-to-r from-red-500 via-magenta-500 to-yellow-500 animate-text">
          <p className="text-white mb-2">Found this site helpful?</p>
          <TipJarButton tipAmount="1" />
        </div>
      </div>
      <div className="mb-4 border border-gray-300 p-4">
        <h2 className="text-2xl font-bold bg-gradient-to-r bg-clip-text text-transparent from-red-500 via-magenta-500 to-yellow-500 animate-text">
          FAST WITHDRAWALS (EXPERIMENTAL)
        </h2>
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
        title="✅ Matched (Thirdweb ↔ Tzkt)"
        searchTerm={searchTerm}
        hashBaseUrl=""
      />
      <DataDisplay
        data={reconciled.blockscoutOnly}
        title="🟦 Only on Blockscout"
        searchTerm={searchTerm}
        hashBaseUrl=""
      />
      <DataDisplay
        data={reconciled.thirdwebOnly}
        title="🟧 Only on Thirdweb"
        searchTerm={searchTerm}
        hashBaseUrl=""
      />
      <DataDisplay
        data={reconciled.tzktOnly}
        title="🟪 Only on Tzkt"
        searchTerm={searchTerm}
        hashBaseUrl=""
      />
      <hr className="mb-2 mt-8" />
      <p className="mb-4 text-xs">
        BETA WARNING: Data might be wrong or out of date. Fast Withdrawals are experimental. Updated hourly: &nbsp;
        {formatTimestamp(blockscoutTimestamp)} UTC (Blockscout)&nbsp;
        {formatTimestamp(thirdwebTimestamp)} UTC (Thirdweb)&nbsp;
        {formatTimestamp(tzktFastTimestamp)} UTC (Tzkt Fast)&nbsp;
      </p>
      <p className="mb-4 text-xs">Source: Blockscout, Thirdweb, TzKT API</p>
      <p className="mb-4 text-xs">
        Community tool by <a href="https://twitter.com/bors___">bors__nft</a> tz1fb6jz7rh4H7AojLShvhiXKaSNDyvkH7sM | 0x4fb30f8cce1f80fc9cc45f7f626069be7549af59
      </p>
    </div>
  );
}
