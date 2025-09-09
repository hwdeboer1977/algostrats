import ConnectButton from "./ConnectButton";
import VaultInteractions from "./VaultInteractions";
import Card from "./Card";
import "./App.css";
import { Link } from "react-router-dom";

const ENABLE_ADMIN = import.meta.env.VITE_ENABLE_ADMIN === "true";

export default function App() {
  return (
    <div className="shell">
      <header
        className="shell__top"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1>Algostrats</h1>
        {ENABLE_ADMIN && (
          <Link
            to="/admin"
            style={{
              fontSize: 26,
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid #ddd",
              textDecoration: "none",
              opacity: 0.8,
            }}
            title="Owner utilities"
          >
            Admin
          </Link>
        )}
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
