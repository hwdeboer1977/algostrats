import { useContext } from "react";
import { WalletContext } from "./WalletContext";

export default function App() {
  const {
    isConnected,
    walletAddress,
    nativeBalance,
    connectWallet,
    disconnectWallet,
  } = useContext(WalletContext);

  const short = (a) => (a ? a.slice(0, 6) + "..." + a.slice(-4) : "");

  return (
    <div style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <div style={{ padding: 20, border: "1px solid #ddd", borderRadius: 8 }}>
        <h1 style={{ marginTop: 0 }}>Vault Frontend</h1>
        <p style={{ color: "#666", fontSize: 12 }}>
          {isConnected ? "Connected" : "Not connected"}
        </p>
        {!isConnected ? (
          <button onClick={connectWallet}>Connect Wallet</button>
        ) : (
          <>
            <p>Connected: {short(walletAddress)}</p>
            <p>Balance: {nativeBalance} ETH</p>
            <button onClick={disconnectWallet}>Disconnect</button>
          </>
        )}
      </div>
    </div>
  );
}
