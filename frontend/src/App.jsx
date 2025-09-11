// src/App.jsx
import ConnectButton from "./ConnectButton";
import VaultInteractions from "./VaultInteractions";
import "./AdminLayout.css"; // reuse the shared styles
import { Link } from "react-router-dom";

const ENABLE_ADMIN = import.meta.env.VITE_ENABLE_ADMIN === "true";

export default function App() {
  return (
    <div className="admin-wrap">
      {/* Header */}
      <header className="page-header">
        <h1 className="brand">Algostrats</h1>
        {ENABLE_ADMIN && (
          <Link to="/admin" className="admin-pill" title="Owner utilities">
            Admin
          </Link>
        )}
      </header>

      {/* 2 cards side-by-side */}
      <main className="content-grid">
        <section className="card">
          <div className="section-title">Wallet</div>
          <ConnectButton />
        </section>

        <section className="card">
          <div className="section-title">Vault</div>
          <VaultInteractions />
        </section>
      </main>
    </div>
  );
}
