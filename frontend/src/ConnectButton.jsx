import React from "react";
import { ethers } from "ethers";
import { useWallet } from "./WalletProvider";

export default function ConnectButton() {
  const {
    connected,
    address,
    nativeBalance,
    chain,
    connect,
    disconnect,
    availableWallets,
  } = useWallet();

  if (connected) {
    return (
      <div className="flex flex-col gap-2 items-start p-4">
        <span>{chain?.name ?? "Unknown network"}</span>
        <span>
          {nativeBalance != null
            ? `${Number(ethers.formatEther(nativeBalance)).toFixed(4)} ${
                chain?.native ?? "ETH"
              }`
            : "…"}
        </span>
        <span>
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button
          onClick={disconnect}
          className="px-3 py-1 rounded bg-red-600 text-white"
        >
          Disconnect
        </button>
      </div>
    );
  }

  // If multiple wallets found (EIP-6963)
  if (availableWallets?.length > 1) {
    return (
      <div className="flex flex-col gap-2 p-4">
        {availableWallets.map((p) => (
          <button
            key={p.info.uuid}
            onClick={() => connect(p)}
            className="px-3 py-1 rounded bg-black text-white"
          >
            Connect {p.info.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="p-4">
      <button
        onClick={() => connect()}
        className="px-3 py-1 rounded bg-black text-white"
      >
        Connect Wallet
      </button>
    </div>
  );
}
