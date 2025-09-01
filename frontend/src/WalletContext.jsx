import { createContext, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";

export const WalletContext = createContext(null);

export function WalletProvider({ children }) {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [walletAddress, setWalletAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [nativeBalance, setNativeBalance] = useState(null);

  const listenersAttached = useRef(false);

  // On mount: detect already-connected accounts (no popup)
  useEffect(() => {
    (async () => {
      if (!window.ethereum) return;
      try {
        const accounts = await window.ethereum.request({
          method: "eth_accounts",
        });
        if (accounts && accounts.length > 0) {
          const _provider = new ethers.BrowserProvider(window.ethereum);
          const _signer = await _provider.getSigner();
          const net = await _provider.getNetwork();
          const addr = accounts[0];

          setProvider(_provider);
          setSigner(_signer);
          setWalletAddress(addr);
          setChainId(Number(net.chainId));

          const bal = await _provider.getBalance(addr);
          setNativeBalance(ethers.formatEther(bal));
        }
      } catch (e) {
        console.warn("auto-init error:", e);
      }
    })();
  }, []);

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Please install MetaMask (or a compatible wallet).");
      return;
    }
    try {
      // 1) Request accounts (this triggers the popup)
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      if (!accounts || accounts.length === 0) return;

      // 2) Build provider/signer
      const _provider = new ethers.BrowserProvider(window.ethereum);
      const _signer = await _provider.getSigner();
      const net = await _provider.getNetwork();
      const addr = accounts[0];

      // 3) Set state
      setProvider(_provider);
      setSigner(_signer);
      setWalletAddress(addr);
      setChainId(Number(net.chainId));

      const bal = await _provider.getBalance(addr);
      setNativeBalance(ethers.formatEther(bal));
    } catch (err) {
      console.error("[connect] error:", err);
      if (err && err.code === 4001) alert("Connection request was rejected.");
    }
  };

  const disconnectWallet = () => {
    setProvider(null);
    setSigner(null);
    setWalletAddress(null);
    setChainId(null);
    setNativeBalance(null);
  };

  // Attach listeners once
  useEffect(() => {
    if (!window.ethereum || listenersAttached.current) return;

    const onAccountsChanged = async (accounts) => {
      if (!accounts || accounts.length === 0) {
        disconnectWallet();
        return;
      }
      const addr = accounts[0];
      setWalletAddress(addr);
      if (provider) {
        try {
          const bal = await provider.getBalance(addr);
          setNativeBalance(ethers.formatEther(bal));
        } catch {}
      }
    };

    const onChainChanged = async (hexId) => {
      const parsed = parseInt(hexId, 16);
      setChainId(parsed);
      try {
        const _provider = new ethers.BrowserProvider(window.ethereum);
        setProvider(_provider);
        const _signer = await _provider.getSigner();
        setSigner(_signer);
        const addr = await _signer.getAddress();
        setWalletAddress(addr);
        const bal = await _provider.getBalance(addr);
        setNativeBalance(ethers.formatEther(bal));
      } catch (e) {
        console.error("chainChanged reinit error:", e);
      }
    };

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    listenersAttached.current = true;

    return () => {
      window.ethereum.removeListener("accountsChanged", onAccountsChanged);
      window.ethereum.removeListener("chainChanged", onChainChanged);
      listenersAttached.current = false;
    };
  }, [provider]);

  // Make this simple: if we have an address, we’re connected
  const isConnected = useMemo(() => !!walletAddress, [walletAddress]);

  return (
    <WalletContext.Provider
      value={{
        isConnected,
        walletAddress,
        nativeBalance,
        chainId,
        provider,
        signer,
        connectWallet,
        disconnectWallet,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}
