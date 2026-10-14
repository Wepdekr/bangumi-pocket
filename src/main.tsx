import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { UpdateProvider } from "./UpdateManager";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UpdateProvider>
      <App />
    </UpdateProvider>
  </React.StrictMode>,
);
