// The vendored gateway-trace test uses jest-dom matchers and relies on RTL cleaning up between tests.
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());
// The Real-or-mock modal remembers a dismissal in sessionStorage; every test starts with it open again.
afterEach(() => { try { sessionStorage.clear(); } catch { /* none */ } });
