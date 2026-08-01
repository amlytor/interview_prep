import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { StoreProvider } from "./lib/store";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <StoreProvider>
      <App />
    </StoreProvider>
  </StrictMode>,
);

// Register the offline worker, in production only — during `npm run dev` a
// service worker sitting in front of the dev server just confuses hot reload.
// Registration is deliberately not awaited: it is an enhancement, and a failure
// (unsupported browser, insecure origin) must not affect the app at all.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.warn("QuantPrep couldn't register its offline worker.", err);
    });
  });
}
