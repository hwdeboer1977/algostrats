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
    if (!availableWallets || availableWallets.length <= 1) {
      await connect(); // connect to default
    } else {
      setShowModal(true);
    }
  };

  if (connected) {
    return (
      <div className="wallet-box">
        <div className="wallet-row">
          <span className="label">Chain:</span>
          <span>{chain?.name ?? "Unknown"}</span>
        </div>
        <div className="wallet-row">
          <span className="label">Native Balance:</span>
          <span>
            {nativeBalance != null
              ? `${Number(ethers.formatEther(nativeBalance)).toFixed(4)} ${
                  chain?.native ?? "ETH"
                }`
              : "…"}
          </span>
        </div>
        <div className="wallet-row">
          <span className="label">Wallet Address:</span>
          <span>
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
        </div>

        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-danger" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button className="btn btn-secondary" onClick={handleClick}>
        Connect Wallet
      </button>

      {/* Modal */}
      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="section-title" style={{ marginBottom: 8 }}>
              Choose a wallet
            </div>
            <div className="modal-list">
              {(availableWallets || []).map((entry) => (
                <button
                  key={entry.info.uuid}
                  className="btn btn-secondary modal-item"
                  onClick={async () => {
                    await connect(entry);
                    setShowModal(false);
                  }}
                >
                  <span>{entry.info.name}</span>
                  <span className="muted">{entry.info.rdns}</span>
                </button>
              ))}
            </div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setShowModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
