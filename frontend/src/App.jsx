import React from "react";
import ConnectButton from "./ConnectButton";
import VaultInteractions from "./VaultInteractions";
import Card from "./Card";
import "./App.css";

export default function App() {
  return (
    <div className="shell">
      <header className="shell__top">
        <h3>Algostrats</h3>
      </header>

      <main className="grid">
        <Card title="Wallet">
          <ConnectButton />
        </Card>

        <Card title="Vault">
          <VaultInteractions />
        </Card>
      </main>
    </div>
  );
}
