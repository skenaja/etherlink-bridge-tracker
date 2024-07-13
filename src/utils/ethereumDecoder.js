const { ethers } = require("ethers");

function decodeInputData(inputData, abiSignature) {
  try {
    // Remove '0x' prefix if present
    inputData = inputData.startsWith("0x") ? inputData.slice(2) : inputData;

    // Get the function selector (first 4 bytes of the input data)
    const functionSelector = inputData.slice(0, 8);

    // Calculate the expected function selector from the ABI signature
    const iface = new ethers.utils.Interface([`function ${abiSignature}`]);
    const expectedSelector = iface.getSighash(abiSignature).slice(2);

    // Check if the function selector matches the expected selector
    if (functionSelector !== expectedSelector) {
      throw new Error(
        `Function selector mismatch. Expected: ${expectedSelector}, Got: ${functionSelector}`,
      );
    }

    // Decode the parameters
    const decodedParams = iface.decodeFunctionData(
      abiSignature,
      `0x${inputData}`,
    );

    return decodedParams[0];
  } catch (error) {
    console.error("Error decoding input data:", error);
    return null;
  }
}

module.exports = { decodeInputData };
