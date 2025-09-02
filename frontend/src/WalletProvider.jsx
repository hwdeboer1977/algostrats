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

// Read-only fallback when not connected
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
  const [injectedProvider, setInjectedProvider] = useState(null); // raw EIP-1193 provider
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(defaultChainId);
  const [nativeBalance, setNativeBalance] = useState(null);
  const [availableWallets, setAvailableWallets] = useState([]); // EIP-6963 discovered wallets
  const [version, setVersion] = useState(0); // bump to force refreshes

  const blockListenerAttached = useRef(false);

  // EIP-6963 discovery
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

  // Effective provider for reads (signer if connected, else readonly)
  const provider = useMemo(
    () => signer?.provider ?? readonlyProvider,
    [signer, readonlyProvider]
  );

  // Connect (optionally a specific EIP-6963 provider)
  const connect = useCallback(async (wallet = null) => {
    const injected = wallet?.provider ?? window.ethereum;
    if (!injected) throw new Error("No injected wallet found.");

    const bp = new ethers.BrowserProvider(injected, "any");
    const accounts = await bp.send("eth_requestAccounts", []);
    if (!accounts?.length) throw new Error("No accounts returned.");

    const _signer = await bp.getSigner();
    const net = await bp.getNetwork();

    setInjectedProvider(injected);
    setBrowserProvider(bp);
    setSigner(_signer);
    setAddress(ethers.getAddress(_signer.address));
    setChainId(Number(net.chainId));
    localStorage.setItem("WALLET_CONNECTED", "1");
    setVersion((v) => v + 1);
  }, []);

  const disconnect = useCallback(() => {
    setSigner(null);
    setAddress(null);
    setBrowserProvider(null);
    setInjectedProvider(null);
    localStorage.removeItem("WALLET_CONNECTED");
    setVersion((v) => v + 1);
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
        setVersion((v) => v + 1);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // EIP-1193 listeners — use RAW injected provider (not ethers)
  useEffect(() => {
    const inj = injectedProvider ?? window.ethereum;
    if (!inj?.on) return;

    const onAccountsChanged = async (accs) => {
      if (!accs?.length) return disconnect();
      setAddress(ethers.getAddress(accs[0]));
      if (browserProvider) setSigner(await browserProvider.getSigner());
      setVersion((v) => v + 1);
    };

    const onChainChanged = async (hexChainId) => {
      const n = Number(hexChainId);
      try {
        // Rebuild BrowserProvider + Signer so downstream memos/effects refresh
        const bp = new ethers.BrowserProvider(inj, "any");
        const _signer = await bp.getSigner().catch(() => null);

        setBrowserProvider(bp);
        setSigner(_signer);
        setChainId(n);
        setNativeBalance(null); // force re-fetch on next block

        if (CHAINS[n]) setReadonlyProvider(makeReadonlyProvider(n));
        setVersion((v) => v + 1);
      } catch {
        /* ignore */
      }
    };

    inj.on("accountsChanged", onAccountsChanged);
    inj.on("chainChanged", onChainChanged);
    return () => {
      inj.removeListener?.("accountsChanged", onAccountsChanged);
      inj.removeListener?.("chainChanged", onChainChanged);
    };
  }, [injectedProvider, browserProvider, disconnect]);

  // Native balance updates on new blocks (when connected)
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
    onBlock(); // initial fetch
    return () => {
      try {
        provider.off("block", onBlock);
      } catch {}
      blockListenerAttached.current = false;
    };
  }, [provider, address, balanceOnBlock, version]);

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
      version, // bumping when accounts/chain changes

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
      version,
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
  const { provider, signer, version } = useWallet();
  return useMemo(() => {
    if (!address || !abi || !provider) return null;
    const runner = withSigner && signer ? signer : provider;
    return new ethers.Contract(address, abi, runner);
    // depend on version so contract instance refreshes after chain switch
  }, [address, abi, provider, signer, withSigner, version]);
}

const erc20Abi = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

const decimalsCache = new Map();

export function useERC20Balance(tokenAddress, ownerAddress) {
  const { provider, version } = useWallet();
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
    // re-run on chain/account/provider changes via `version`
  }, [provider, tokenAddress, ownerAddress, version]);

  const formatted = useMemo(() => {
    if (raw == null || decimals == null) return null;
    return ethers.formatUnits(raw, decimals);
  }, [raw, decimals]);

  return { raw, formatted, decimals, symbol };
}
