import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/*.test.jsx", "web/src/gateway-trace/*.test.jsx", "web/src/floating-dialog/*.test.jsx", "web/src/run-observability/*.test.jsx"],
    setupFiles: ["./test/setup-jest-dom.js"]
  }
});
