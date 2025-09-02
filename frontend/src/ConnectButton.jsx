import React, { useState } from "react";
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

  const [showModal, setShowModal] = useState(false);

  const handleClick = async () => {
    // if no wallet or only one → connect directly
    if (!availableWallets || availableWallets.length <= 1) {
      await connect();
    } else {
      setShowModal(true);
    }
  };

  if (connected) {
    return (
      <div className="flex flex-col gap-2 items-start p-4 border rounded-xl bg-white shadow-sm">
        <div className="flex items-center gap-2 text-sm">
          <span className="px-2 py-1 rounded bg-gray-100">
            {chain?.name ?? "Unknown"}
          </span>
          <span className="px-2 py-1 rounded bg-gray-100">
            {nativeBalance != null
              ? `${Number(ethers.formatEther(nativeBalance)).toFixed(4)} ${
                  chain?.native ?? "ETH"
                }`
              : "…"}
          </span>
          <span className="px-2 py-1 rounded bg-gray-100 font-mono">
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
        </div>
        <button
          onClick={disconnect}
          className="px-3 py-1 rounded bg-red-600 text-white hover:bg-red-700"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <>
      <button
        onClick={handleClick}
        className="px-4 py-2 rounded-xl bg-black text-white hover:opacity-90"
      >
        Connect Wallet
      </button>

      {/* Popup Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-semibold">Choose a wallet</h2>
            <div className="flex flex-col gap-2">
              {availableWallets.map((entry) => (
                <button
                  key={entry.info.uuid}
                  onClick={async () => {
                    await connect(entry);
                    setShowModal(false);
                  }}
                  className="flex items-center justify-between rounded-lg border px-4 py-2 hover:bg-gray-50"
                >
                  <span>{entry.info.name}</span>
                  <span className="text-xs text-gray-500">
                    {entry.info.rdns}
                  </span>
                </button>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setShowModal(false)}
                className="px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
