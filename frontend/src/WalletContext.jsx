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
  const onAccountsChangedRef = useRef(null);
  const onChainChangedRef = useRef(null);

  // On mount: detect already-connected accounts (no popup)
  useEffect(() => {
    (async () => {
      if (!window.ethereum) return;
      try {
        const accounts = await window.ethereum.request({
          method: "eth_accounts",
        });
        console.log("[auto-init] eth_accounts:", accounts);
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
        console.warn("[auto-init] error:", e);
      }
    })();
  }, []);

  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Please install MetaMask (or a compatible wallet).");
      return;
    }
    try {
      console.log("[connect] requesting accounts…");
      let accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      // Fallback: some wallets may require explicit permission request
      if (!accounts || accounts.length === 0) {
        console.log("[connect] empty accounts, requesting permissions…");
        try {
          await window.ethereum.request({
            method: "wallet_requestPermissions",
            params: [{ eth_accounts: {} }],
          });
          accounts = await window.ethereum.request({ method: "eth_accounts" });
        } catch (permErr) {
          console.warn("[connect] wallet_requestPermissions failed:", permErr);
        }
      }

      if (!accounts || accounts.length === 0) {
        console.warn("[connect] still no accounts; aborting.");
        return;
      }

      // Build provider/signer fresh on every connect
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

      console.log("[connect] connected:", {
        addr,
        chainId: Number(net.chainId),
      });
    } catch (err) {
      console.error("[connect] error:", err);
      if (err && err.code === 4001) alert("Connection request was rejected.");
    }
  };

  const disconnectWallet = () => {
    // Explicitly remove listeners so we can cleanly reattach on next connect
    if (window.ethereum && listenersAttached.current) {
      try {
        if (onAccountsChangedRef.current) {
          window.ethereum.removeListener(
            "accountsChanged",
            onAccountsChangedRef.current
          );
        }
        if (onChainChangedRef.current) {
          window.ethereum.removeListener(
            "chainChanged",
            onChainChangedRef.current
          );
        }
      } catch (e) {
        console.warn(
          "[disconnect] removing listeners failed (safe to ignore):",
          e
        );
      }
      listenersAttached.current = false;
      onAccountsChangedRef.current = null;
      onChainChangedRef.current = null;
    }

    // Clear app state (wallet may still keep site permission)
    setProvider(null);
    setSigner(null);
    setWalletAddress(null);
    setChainId(null);
    setNativeBalance(null);
    console.log("[disconnect] app state cleared.");
  };

  // Attach listeners once (and re-attach after a disconnect -> connect cycle)
  useEffect(() => {
    if (!window.ethereum || listenersAttached.current) return;

    const onAccountsChanged = async (accounts) => {
      console.log("[listener] accountsChanged:", accounts);
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
        } catch (e) {
          console.error("[listener] balance refresh error:", e);
        }
      }
    };

    const onChainChanged = async (hexId) => {
      const parsed = parseInt(hexId, 16);
      console.log("[listener] chainChanged:", parsed, hexId);
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
        console.error("[listener] chainChanged reinit error:", e);
      }
    };

    onAccountsChangedRef.current = onAccountsChanged;
    onChainChangedRef.current = onChainChanged;

    window.ethereum.on("accountsChanged", onAccountsChanged);
    window.ethereum.on("chainChanged", onChainChanged);
    listenersAttached.current = true;

    console.log("[listeners] attached.");

    return () => {
      try {
        window.ethereum.removeListener("accountsChanged", onAccountsChanged);
        window.ethereum.removeListener("chainChanged", onChainChanged);
      } catch (e) {
        console.warn("[listeners] cleanup error:", e);
      }
      listenersAttached.current = false;
      onAccountsChangedRef.current = null;
      onChainChangedRef.current = null;
      console.log("[listeners] cleaned up.");
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
