import React from "react";
import ConnectButton from "./ConnectButton";

export default function App() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-center">
        <h1 className="text-2xl font-bold mb-6">My dApp</h1>
        <ConnectButton />
      </div>
    </div>
  );
}
