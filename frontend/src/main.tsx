import React from "react";
import ReactDOM from "react-dom/client";
import { CSPProvider } from "@base-ui/react/csp-provider";
import App from "./App";
import "./index.css";
import "@fontsource-variable/figtree";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {/* Base UI injects a <style> tag to hide popup scrollbars. The app CSP
        forbids inline <style> elements, so that rule lives in index.css
        instead (class .base-ui-disable-scrollbar). */}
    <CSPProvider disableStyleElements>
      <App />
    </CSPProvider>
  </React.StrictMode>,
);
