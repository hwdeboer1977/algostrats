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
      <div className="p-4 border rounded-xl bg-white shadow-sm">
        <div className="space-y-2 text-sm">
          <div>
            <span className="font-semibold">Chain:</span>{" "}
            {chain?.name ?? "Unknown"}
          </div>
          <div>
            <span className="font-semibold">Native Balance:</span>{" "}
            {nativeBalance != null
              ? `${Number(ethers.formatEther(nativeBalance)).toFixed(4)} ${
                  chain?.native ?? "ETH"
                }`
              : "…"}
          </div>
          <div>
            <span className="font-semibold">Wallet Address:</span>{" "}
            {address.slice(0, 6)}…{address.slice(-4)}
          </div>
        </div>
        <button onClick={disconnect} className="btn btn--danger mt-4">
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <>
      <button onClick={handleClick} className="btn btn--primary">
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
                  className="btn btn--secondary flex items-center justify-between"
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
                className="btn btn--secondary"
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
