import React from "react";
import ConnectButton from "./ConnectButton";
import VaultInteractions from "./VaultInteractions";

export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-6">My App</h1>
        <ConnectButton />
        <h1 className="text-2xl font-bold mb-6">More info here</h1>
        <VaultInteractions />
      </div>
    </div>
  );
}
