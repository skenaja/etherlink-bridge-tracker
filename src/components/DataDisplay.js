import React from 'react';

const DataDisplay = ({ data, title, searchTerm, hashBaseUrl = ""}) => {
  const isValidData = Array.isArray(data) && data.length > 0;

  const filteredData = isValidData
    ? data.filter(item =>
        Object.values(item).some(value =>
          value.toString().toLowerCase().includes(searchTerm.toLowerCase())
        )
      )
    : [];

  
  const calculateDaysSince = (timestamp) => {
    const diffTime = Math.abs(new Date() - new Date(timestamp));
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  const getDateStyle = (timestamp, isUnmatched) => {
    if (!isUnmatched || !timestamp) return '';
    const daysSince = calculateDaysSince(timestamp);
    if (daysSince > 16) {
      return 'bg-red-500 text-black font-bold text-nowrap';
    } else if (daysSince >= 14) {
      return 'bg-yellow-500 text-black font-bold text-nowrap';
    }
    return '';
  };

  const isUnmatchedSection = title.toLowerCase().includes('stuck');

  const highlightMatch = (text, searchTerm) => {
    if (!searchTerm.trim()) return text; // Return text as is if searchTerm is empty or only spaces
    
    const regex = new RegExp(`(${searchTerm})`, 'gi');
    const parts = text.split(regex);
    
    return parts.map((part, index) => 
        regex.test(part) ? <span key={index} className="bg-yellow-500 text-black">{part}</span> : part
    );
    };


  return (
    <div className="mb-8">
      <h2 className="text-2xl font-bold mb-4">{title}</h2>
      {filteredData.length > 0 ? (
        <div className="overflow-x-auto max-h-96">
          <table className="min-w-full border border-gray-300 border-collapse">
            <thead className="sticky -top-1  bg-black border-y-2 border-gray-300">
              <tr className='border-gray-300 sticky -top-1'>
                {Object.keys(filteredData[0]).map((key) => (
                  <th key={key} className="px-4 py-4 text-left text-sm sticky -top-1">{key}</th>
                ))}
              </tr>
            </thead>
            <tbody className="max-h-96 overflow-y-auto" >
              {filteredData.map((item, index) => (
                <tr key={index}>
                  {Object.entries(item).map(([key, value], i) => {
                    // Determine the base URL based on the key
                    let dynamicBaseUrl = '';
                    if (key === 'tezosTx') {
                      dynamicBaseUrl = 'https://tzkt.io';
                    } else if (key === 'etherlinkTx') {
                      dynamicBaseUrl = 'https://explorer.etherlink.com/tx';
                    }
              
                    return (
                        <td 
                          key={i} 
                          className={`px-4 py-2 border-t border-gray-300 text-nowrap text-xs ${
                            (key === 'timestamp' || key === 'tzktTimestamp' || key === 'blockscoutTimestamp'  || key === 'sent' || key === 'received' ) 
                              ? getDateStyle(value, isUnmatchedSection) 
                              : ''
                          }`}
                        >
                          {key === 'hash' || key === 'tezosTx' || key === 'etherlinkTx' ? (
                            <a href={`${dynamicBaseUrl}/${value}`} target="_blank" rel="noopener noreferrer">
                              Link
                            </a>
                          ) : (
                            typeof value === 'object' ? JSON.stringify(value) : highlightMatch(value.toString(), searchTerm)
                          )}
                        </td>
                      );
                    })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No data available</p>
      )}
    </div>
  );
};

export default DataDisplay;