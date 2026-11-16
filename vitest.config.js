import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["test/*.test.jsx", "web/src/gateway-trace/*.test.jsx"],
    setupFiles: ["./test/setup-jest-dom.js"]
  }
});
