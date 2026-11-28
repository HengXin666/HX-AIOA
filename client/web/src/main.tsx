import { ThemeProvider } from "@hx/ui/theme";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { watchVersion } from "./core/version";
import "./index.css";

watchVersion();
const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeProvider defaultMode="system">
        <App />
      </ThemeProvider>
    </StrictMode>,
  );
}
