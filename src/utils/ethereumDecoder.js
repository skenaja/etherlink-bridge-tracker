const { ethers } = require("ethers");

/* 
list of signatures & functions:
cda4fee2: withdraw_base58(string) # target
80fc1fe3: withdraw(address,bytes,uint256,bytes22,bytes) # ticketOwner, receiver, amount, ticketer, content
67a32cd7: fast_withdraw_base58(string,string,bytes) # target, fast_withdrawal_contract, payload
*/

// Lookup table for ABI signatures
const abiLookupTable = {
  "cda4fee2": {
    abiSignature: "withdraw_base58(string)",
    type: "withdraw_base58",
  },
  "80fc1fe3": {
    abiSignature: "withdraw(address,bytes,uint256,bytes22,bytes)",
    type: "withdraw",
  },
  "67a32cd7": {
    abiSignature: "fast_withdraw_base58(string,string,bytes)",
    type: "fast_withdraw_base58",
  },
};

function decodeInputData(inputData) {
  try {
    // Remove '0x' prefix if present
    inputData = inputData.startsWith("0x") ? inputData.slice(2) : inputData;

    // Get the function selector (first 4 bytes of the input data)
    const functionSelector = inputData.slice(0, 8);

    // Lookup the ABI signature and type
    const lookupEntry = abiLookupTable[functionSelector];
    if (!lookupEntry) {
      throw new Error(`Unknown function selector: ${functionSelector}`);
    }

    const { abiSignature, type } = lookupEntry;

    // Create an interface for decoding
    const iface = new ethers.utils.Interface([`function ${abiSignature}`]);

    // Decode the parameters
    const decodedParams = iface.decodeFunctionData(
      abiSignature,
      `0x${inputData}`,
    );

    console.log("inputData:", inputData);
    console.log("Decoded type:", type);
    console.log("Decoded data:", decodedParams);

    return { type, decodedData: decodedParams };
  } catch (error) {
    console.error("Error decoding input data:", error);
    return null;
  }
}

module.exports = { decodeInputData };
