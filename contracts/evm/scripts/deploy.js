const { ethers } = require("hardhat");
const fs = require("fs");

// Deploy contract to mainnet: npx hardhat run --network arbmainnet scripts/deploy.js
// Verify contact: npx hardhat verify --network arbmainnet 0x020788f43EF486e6aDDEB3fDCA406442ef88747B 0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f

const WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Network:", (await ethers.provider.getNetwork()).name);

  const Vault = await ethers.getContractFactory("Vault");
  const vault = await Vault.deploy(WBTC);
  await vault.waitForDeployment();

  const addr = await vault.getAddress();
  console.log("Vault deployed to:", addr);

  // persist
  const out = {
    chainId: 42161,
    WBTC,
    vault: addr,
    deployedBy: deployer.address,
    ts: Date.now(),
  };
  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync(
    "deployments/arbitrumOne.json",
    JSON.stringify(out, null, 2)
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
