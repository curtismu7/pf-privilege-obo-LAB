import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "../standalone-ui.css";
import "./components/JsonPane.css";
import "./components/VerifyMark.css";
import "./gateway-trace/gateway-trace.css";
import "./run-observability/run-observability.css";
import "../app.css";

createRoot(document.getElementById("root")).render(<App />);
