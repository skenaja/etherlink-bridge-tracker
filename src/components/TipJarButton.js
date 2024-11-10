import React, { useState } from 'react';
import { ethers } from 'ethers';
import { AlertCircle, ExternalLink, Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import Image from 'next/image';

const TipJarButton = ({ tipAmount = '1' }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Replace with your wallet address
  const RECIPIENT_ADDRESS = '0x4fb30f8CcE1F80FC9CC45F7F626069be7549aF59';
  const TIP_AMOUNT = tipAmount;

  const ETHERLINK_CHAIN_PARAMS = {
    chainId: '0xA729',
    chainName: 'Etherlink Mainnet',
    nativeCurrency: {
      name: 'tez',
      symbol: 'XTZ',
      decimals: 18,
    },
    rpcUrls: ['https://node.mainnet.etherlink.com'],
    blockExplorerUrls: ['https://explorer.etherlink.com'],
  };

  const resetState = () => {
    setError('');
    setSuccess(false);
    setLoading(false);
  };

  const handleTip = async () => {
    resetState();
    setLoading(true);

    try {
      if (!window.ethereum) {
        throw new Error('Please install MetaMask to use this feature');
      }

      // Request account access
      const accounts = await window.ethereum.request({ 
        method: 'eth_requestAccounts' 
      });
      
      // Check if we're on the right network (etherlink chain id 0xa729)
      const chainId = await window.ethereum.request({ 
        method: 'eth_chainId' 
      });
      
      if (chainId !== '0xA729') {
        try {
          await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0xA729' }],
          });
        } catch (switchError) {
          // This error code indicates that the chain has not been added to MetaMask
          if (switchError.code === 4902) {
            try {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [ETHERLINK_CHAIN_PARAMS],
              });
            } catch (addError) {
              throw new Error('Failed to add Etherlink chain to MetaMask');
            }
          } else {
            throw switchError;
          }
        }
      }

      const provider = new ethers.providers.Web3Provider(window.ethereum);
      const signer = await provider.getSigner();
      
      // Send the transaction
      const tx = await signer.sendTransaction({
        to: RECIPIENT_ADDRESS,
        value: ethers.utils.parseEther(TIP_AMOUNT),
      });

      await tx.wait();
      setSuccess(true);

    } catch (err) {
      if (err.code === -32603 && err.data && err.data.code === -32005) {
        setError('Transaction failed: Not enough funds in your account.');
      } else if (err.code === 'ACTION_REJECTED') {
        setError('Transaction rejected by user.');
      } else {
        setError(err.message || 'Failed to send tip');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <Button
        onClick={handleTip}
        disabled={loading}
        className="w-full flex items-center justify-center"
      >
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Processing...
          </>
        ) : (
          <>
            <Image src="/mm-icon.svg" alt="MetaMask Icon" width={16} height={16} className="mr-2" />
            {`Send ${TIP_AMOUNT} XTZ Tip`}
            <Image src="/etherlink.svg" alt="Etherlink Icon" width={16} height={16} className="mr-2" />
          </>
        )}
      </Button>

      {error && (
        <Alert className="bg-black width-1/3" variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="width-1/3 bg-black text-green-700 border-green-200">
          <ExternalLink className="h-4 w-4" />
          <AlertDescription>
            Tip sent successfully! Thank you for your support!
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

export default TipJarButton;