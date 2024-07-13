import React, { useState, useEffect } from 'react';
import axios from 'axios';
import DataDisplay from '../components/DataDisplay';

export default function Home() {
  const [tzktData, setTzktData] = useState([]);
  const [ethereumData, setEthereumData] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const fetchData = async () => {
      try {
        const tzktResponse = await axios.get('/tzktDataCache.json');
        setTzktData(tzktResponse.data);
        // add some debugging here to check what data came back from setTzktData
        // console.log(tzktResponse.data);

        const ethereumResponse = await axios.get('/blockscoutDataCache.json');
        setEthereumData(ethereumResponse.data);
        // add some debugging here to check what data came back from setEthereumData
        // console.log(ethereumResponse.data);

      } catch (error) {
        console.error('Error fetching data:', error);
      }
    };

    fetchData();
  }, []);

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-4xl font-bold mb-8">Etherlink Bridge Withdrawals Tracker</h1>
      <input
        type="text"
        placeholder="Type to search..."
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="mb-4 p-2 border border-gray-300"
      />
      <DataDisplay
        data={tzktData}
        searchTerm={searchTerm}
        title="Tezos Data"
        hashBaseUrl="https://tzkt.io"
      />
      <DataDisplay
        data={ethereumData}
        searchTerm={searchTerm}
        title="Etherlink Data"
        hashBaseUrl="https://explorer.etherlink.com/tx"
      />
    </div>
  );
}