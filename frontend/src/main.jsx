import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import App from "./App";
import Admin from "./Admin.jsx"; // you'll create this file next
import { WalletProvider } from "./WalletProvider";

const ENABLE_ADMIN = import.meta.env.VITE_ENABLE_ADMIN === "true";

const routes = [
  { path: "/", element: <App /> },
  ...(ENABLE_ADMIN ? [{ path: "/admin", element: <Admin /> }] : []),
  { path: "*", element: <div style={{ padding: 24 }}>Not found</div> },
];

const router = createBrowserRouter(routes);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <WalletProvider>
      <RouterProvider router={router} />
    </WalletProvider>
  </StrictMode>
);
