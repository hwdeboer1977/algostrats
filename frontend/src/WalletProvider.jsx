// src/wallet/WalletProvider.jsx
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ethers } from "ethers";

// --- Chains you care about (extend as needed) ---
const CHAINS = {
  1: {
    chainId: "0x1",
    name: "Ethereum",
    native: "ETH",
    rpcUrls: ["https://rpc.ankr.com/eth"],
    blockExplorerUrls: ["https://etherscan.io"],
  },
  42161: {
    chainId: "0xa4b1",
    name: "Arbitrum",
    native: "ETH",
    rpcUrls: ["https://arb1.arbitrum.io/rpc"],
    blockExplorerUrls: ["https://arbiscan.io"],
  },
  8453: {
    chainId: "0x2105",
    name: "Base",
    native: "ETH",
    rpcUrls: ["https://mainnet.base.org"],
    blockExplorerUrls: ["https://basescan.org"],
  },
};

export const WalletContext = createContext(null);

// Fallback JSON-RPC (read-only) when not connected
function makeReadonlyProvider(preferredChainId = 1) {
  const chain = CHAINS[preferredChainId] ?? CHAINS[1];
  return new ethers.JsonRpcProvider(chain.rpcUrls[0]);
}

export function WalletProvider({
  children,
  defaultChainId = 1,
  balanceOnBlock = true,
}) {
  const [readonlyProvider, setReadonlyProvider] = useState(() =>
    makeReadonlyProvider(defaultChainId)
  );
  const [browserProvider, setBrowserProvider] = useState(null); // ethers.BrowserProvider
  const [injectedProvider, setInjectedProvider] = useState(null); // raw EIP-1193 provider (window.ethereum or EIP-6963)
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(defaultChainId);
  const [nativeBalance, setNativeBalance] = useState(null);
  const [availableWallets, setAvailableWallets] = useState([]); // EIP-6963 discovered wallets

  const blockListenerAttached = useRef(false);

  // EIP-6963 discovery (nice to have)
  useEffect(() => {
    const providers = new Map();
    const onAnnounce = (event) => {
      const d = event.detail;
      if (!d?.info || !d?.provider) return;
      providers.set(d.info.uuid, d);
      setAvailableWallets(Array.from(providers.values()));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () =>
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  // effective provider for reads (signer if connected, else readonly)
  const provider = useMemo(
    () => signer?.provider ?? readonlyProvider,
    [signer, readonlyProvider]
  );

  // Connect to a wallet (optionally a specific EIP-6963 provider)
  const connect = useCallback(async (wallet = null) => {
    const injected = wallet?.provider ?? window.ethereum;
    if (!injected) throw new Error("No injected wallet found.");

    const bp = new ethers.BrowserProvider(injected, "any");
    const accounts = await bp.send("eth_requestAccounts", []);
    if (!accounts?.length) throw new Error("No accounts returned.");

    const _signer = await bp.getSigner();
    const net = await bp.getNetwork();

    setInjectedProvider(injected); // keep raw provider for EIP-1193 events
    setBrowserProvider(bp);
    setSigner(_signer);
    setAddress(ethers.getAddress(_signer.address));
    setChainId(Number(net.chainId));
    localStorage.setItem("WALLET_CONNECTED", "1");
  }, []);

  const disconnect = useCallback(() => {
    setSigner(null);
    setAddress(null);
    setBrowserProvider(null);
    setInjectedProvider(null);
    localStorage.removeItem("WALLET_CONNECTED");
  }, []);

  // Silent auto-reconnect on mount
  useEffect(() => {
    (async () => {
      const wasConnected = localStorage.getItem("WALLET_CONNECTED") === "1";
      const injected = window.ethereum;
      if (!injected || !wasConnected) return;
      try {
        const accounts = await injected
          .request({ method: "eth_accounts" })
          .catch(() => []);
        if (!accounts?.length) return;
        const bp = new ethers.BrowserProvider(injected, "any");
        const _signer = await bp.getSigner();
        const net = await bp.getNetwork();

        setInjectedProvider(injected);
        setBrowserProvider(bp);
        setSigner(_signer);
        setAddress(ethers.getAddress(_signer.address));
        setChainId(Number(net.chainId));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // Listen to EIP-1193 events on the RAW provider (not on ethers BrowserProvider)
  useEffect(() => {
    const inj = injectedProvider ?? window.ethereum;
    if (!inj?.on) return;

    const onAccountsChanged = async (accs) => {
      if (!accs?.length) return disconnect();
      setAddress(ethers.getAddress(accs[0]));
      if (browserProvider) setSigner(await browserProvider.getSigner());
    };

    const onChainChanged = async (hexChainId) => {
      const n = Number(hexChainId);
      setChainId(n);
      if (browserProvider) setSigner(await browserProvider.getSigner());
      if (CHAINS[n]) setReadonlyProvider(makeReadonlyProvider(n));
    };

    inj.on("accountsChanged", onAccountsChanged);
    inj.on("chainChanged", onChainChanged);
    return () => {
      inj.removeListener?.("accountsChanged", onAccountsChanged);
      inj.removeListener?.("chainChanged", onChainChanged);
    };
  }, [injectedProvider, browserProvider, disconnect]);

  // Native balance updates on each new block (only when connected)
  useEffect(() => {
    if (!balanceOnBlock || !provider || !address) return;
    if (blockListenerAttached.current) return;
    blockListenerAttached.current = true;

    const onBlock = async () => {
      try {
        const bal = await provider.getBalance(address);
        setNativeBalance(bal); // BigInt
      } catch {
        /* ignore */
      }
    };

    provider.on("block", onBlock);
    onBlock(); // initial
    return () => {
      try {
        provider.off("block", onBlock);
      } catch {}
      blockListenerAttached.current = false;
    };
  }, [provider, address, balanceOnBlock]);

  // Switch chain with addChain fallback
  const switchChain = useCallback(
    async (targetId) => {
      const chain = CHAINS[targetId];
      if (!chain) throw new Error("Unknown chain.");
      const inj = injectedProvider ?? window.ethereum;
      if (!inj) throw new Error("No wallet available.");

      try {
        await inj.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chain.chainId }],
        });
      } catch (err) {
        if (
          err?.code === 4902 ||
          (err?.message || "").includes("Unrecognized chain ID")
        ) {
          await inj.request({
            method: "wallet_addEthereumChain",
            params: [
              {
                chainId: chain.chainId,
                chainName: chain.name,
                nativeCurrency: {
                  name: chain.native,
                  symbol: chain.native,
                  decimals: 18,
                },
                rpcUrls: chain.rpcUrls,
                blockExplorerUrls: chain.blockExplorerUrls,
              },
            ],
          });
        } else {
          throw err;
        }
      }
    },
    [injectedProvider]
  );

  const value = useMemo(
    () => ({
      // state
      connected: !!signer,
      address,
      chainId,
      chain: CHAINS[chainId] ?? null,
      nativeBalance, // BigInt
      provider, // ethers Provider for reads
      signer, // ethers Signer for writes
      availableWallets,

      // actions
      connect,
      disconnect,
      switchChain,
      setReadonlyChain: (id) => setReadonlyProvider(makeReadonlyProvider(id)),
    }),
    [
      signer,
      address,
      chainId,
      nativeBalance,
      provider,
      availableWallets,
      connect,
      disconnect,
      switchChain,
    ]
  );

  return (
    <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
  );
}

// ---------- Handy hooks ----------

export function useWallet() {
  const ctx = React.useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within <WalletProvider>");
  return ctx;
}

export function useContract(address, abi, withSigner = true) {
  const { provider, signer } = useWallet();
  return useMemo(() => {
    if (!address || !abi || !provider) return null;
    const runner = withSigner && signer ? signer : provider;
    return new ethers.Contract(address, abi, runner);
  }, [address, abi, provider, signer, withSigner]);
}

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const decimalsCache = new Map();

export function useERC20Balance(tokenAddress, ownerAddress) {
  const { provider } = useWallet();
  const [raw, setRaw] = useState(null);
  const [decimals, setDecimals] = useState(null);
  const [symbol, setSymbol] = useState(null);

  useEffect(() => {
    let stop = false;
    (async () => {
      if (!provider || !tokenAddress || !ownerAddress) return;
      try {
        const c = new ethers.Contract(tokenAddress, erc20Abi, provider);
        let dec = decimalsCache.get(tokenAddress);
        if (dec == null) {
          dec = await c.decimals();
          decimalsCache.set(tokenAddress, dec);
        }
        const sym = await c.symbol().catch(() => "");
        const bal = await c.balanceOf(ownerAddress);
        if (!stop) {
          setDecimals(Number(dec));
          setSymbol(sym);
          setRaw(bal); // BigInt
        }
      } catch {
        if (!stop) {
          setDecimals(null);
          setSymbol(null);
          setRaw(null);
        }
      }
    })();
    return () => {
      stop = true;
    };
  }, [provider, tokenAddress, ownerAddress]);

  const formatted = useMemo(() => {
    if (raw == null || decimals == null) return null;
    return ethers.formatUnits(raw, decimals);
  }, [raw, decimals]);

  return { raw, formatted, decimals, symbol };
}
