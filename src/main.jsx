import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./storage-shim.js"; // must run before ZoneApp touches window.storage
import "./index.css";
import ZoneApp from "./ZoneApp.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <ZoneApp />
  </StrictMode>
);
