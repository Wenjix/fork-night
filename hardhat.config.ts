import { defineConfig } from "hardhat/config";

export default defineConfig({
  networks: { simulation: { type: "edr-simulated", chainType: "l1", chainId: 31337 } },
});
