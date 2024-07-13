import React, { useState, useEffect } from 'react';
import DataDisplay from '../components/DataDisplay';

import tzktDataCache from '../data/tzktDataCache.json';
import blockscoutDataCache from '../data/blockscoutDataCache.json';


export async function getStaticProps() {
  // const filePath1 = path.resolve('./tzktDataCache.json');
  // const filePath2 = path.resolve('./blockscoutDataCache.json');

  // const filePath1 = path.join(process.cwd(), 'public', 'tzktDataCache.json');
  // const filePath2 = path.join(process.cwd(), 'public', 'blockscoutDataCache.json');

  // const jsonData1 = JSON.parse(fs.readFileSync(filePath1, 'utf8'));
  // const jsonData2 = JSON.parse(fs.readFileSync(filePath2, 'utf8'));

  console.log(tzktDataCache.timestamp, blockscoutDataCache.timestamp);
  
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
    return date.toISOString().replace(/:\d{2}\.\d{3}Z$/, '').replace('T', ' ');
}

function reconcileData(tzktData, blockscoutData) {
    const currentDate = new Date();
    const sortedTzktData = [...tzktData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const sortedBlockscoutData = [...blockscoutData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
    const matched = [];
    const unmatched = [];
    const notReady = [];
  
    const tzktByAddress = groupByAddress(sortedTzktData);
    const blockscoutByAddress = groupByAddress(sortedBlockscoutData);
  
    const allAddresses = new Set([...Object.keys(tzktByAddress), ...Object.keys(blockscoutByAddress)]);
    console.log("count of all addresses", allAddresses.size);
  
    allAddresses.forEach(address => {
      const tzktQueue = tzktByAddress[address] || [];
      const blockscoutQueue = blockscoutByAddress[address] || [];
      
  
      while (blockscoutQueue.length > 0) {
        const blockscoutItem = blockscoutQueue.shift();
        const blockscoutDaysSinceTransaction = calculateDayDifference(blockscoutItem.timestamp, currentDate);
        // write to console the data from blockscoutItem but only if blockscoutitem address is equal to "tz1aAvMu1sNAGwDNahHcQc4yDZ7WwoDNjFzu"
        if (blockscoutItem.to === "tz1aAvMu1sNAGwDNahHcQc4yDZ7WwoDNjFzu") {
            console.log("blockscoutItem", blockscoutItem);
            console.log("blockscoutDaysSinceTransaction", blockscoutDaysSinceTransaction);
        }
  
        if (blockscoutDaysSinceTransaction < 14) {
          notReady.push({ ...blockscoutItem, source: 'etherlink' });
          continue;
        }
  
        let matchFound = false;
  
        for (let i = 0; i < tzktQueue.length; i++) {
          const tzktItem = tzktQueue[i];
          const dayDifference = calculateDayDifference(tzktItem.timestamp, blockscoutItem.timestamp);
          // write to console data from tzktitem only if tzktitem address is equal to "tz1aAvMu1sNAGwDNahHcQc4yDZ7WwoDNjFzu"
            if (tzktItem.to === "tz1aAvMu1sNAGwDNahHcQc4yDZ7WwoDNjFzu") {
                console.log("tzktItem", tzktItem);
                console.log("dayDifference", dayDifference);
            }
  
          if (parseFloat(tzktItem.amount) === parseFloat(blockscoutItem.amount) && dayDifference >= 14 && dayDifference <= 60) {
            console.log("match found", tzktItem.amount, blockscoutItem.amount, dayDifference);
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
          unmatched.push({ ...blockscoutItem, source: 'etherlink' });
        }
      }
  
      // Process remaining TzKT items
      tzktQueue.forEach(tzktItem => {
        const tzktDaysSinceTransaction = calculateDayDifference(tzktItem.timestamp, currentDate);
        if (tzktDaysSinceTransaction < 14) {
          notReady.push({ ...tzktItem, source: 'tezos' });
        } else {
          unmatched.push({ ...tzktItem, source: 'tezos' });
        }
      });
    });
  
    // sort matched based on descending order of received timestamp
    const sortedMatched = matched.sort((a, b) => new Date(b.received) - new Date(a.received));

    // Sort unmatched entries in ascending date order
    const sortedUnmatched = unmatched.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    // Sort notReady entries in ascending date order
    const sortedNotReady = notReady.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return { matched: sortedMatched, unmatched: sortedUnmatched, notReady: sortedNotReady };
  }
  
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


  export default function ReconcilePage({ tzktData, blockscoutData, blockscoutTimestamp, tzktTimestamp }) {
    const [reconciled, setReconciled] = useState({ matched: [], unmatched: [], notReady: [] });
    const [searchTerm, setSearchTerm] = useState('');
  
    useEffect(() => {
      const result = reconcileData(tzktData, blockscoutData);
      setReconciled(result);
    }, [tzktData, blockscoutData]);
  
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8">Etherlink Mainnet Bridge Withdrawals Tracker</h1>
        {/* add the timestamps from blockscoutTimestamp & tzktTimestamp in date and time utc iso-6801 format*/}
        <p className="mb-4 text-xs">Data last updated (UTC):&nbsp;
             { formatTimestamp(blockscoutTimestamp) } (Etherlink)&nbsp;
             { formatTimestamp(tzktTimestamp) } (Tezos)
        </p>
        <p className="mb-4 text-xs">Source: Etherlink Explorer, TzKT API</p>
        <input
            type="text"
            placeholder="Type to filter..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="mb-4 p-2 border border-gray-300"
        />
        
        <DataDisplay data={reconciled.matched} title="&#x2705; Transferred" searchTerm={searchTerm} hashBaseUrl="" />
        <DataDisplay data={reconciled.unmatched} title="&#x2757; Ready but Temporarily Stuck" searchTerm={searchTerm} hashBaseUrl=""/>
        <DataDisplay data={reconciled.notReady} title="&#x1F4A4; Not Ready - transfer was less than 14 days ago" searchTerm={searchTerm} hashBaseUrl=""/>
      </div>
    );
  }