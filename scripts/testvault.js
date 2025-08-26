const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");
const { MaxUint256 } = require("@ethersproject/constants");
const ERC20ABI = require("./abis/ERC20.json");
const VAULTABI = require("./abis/VAULT.json");

// Load .env (prefer CWD, fallback to repo root)
(() => {
  const cwdEnv = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(cwdEnv)) dotenv.config({ path: cwdEnv });
  else dotenv.config({ path: path.resolve(__dirname, "../.env") });
})();

const RPC_URL = process.env.ARBITRUM_ALCHEMY_MAINNET;
const PK = process.env.WALLET_SECRET;
const VAULT = "0x020788f43EF486e6aDDEB3fDCA406442ef88747B";
const WBTC = "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f";

async function main() {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PK, provider);
  const me = await wallet.getAddress();
  console.log("My wallet: ", me);

  const net = await provider.getNetwork();
  console.log(`→ Network: ${net.name} (chainId ${net.chainId})`);

  const vault = new ethers.Contract(VAULT, VAULTABI, wallet);
  const wbtc = new ethers.Contract(WBTC, ERC20ABI, wallet);

  const [shareDec, shareSym, assetAddr, paused, assetDec, assetSym] =
    await Promise.all([
      vault.decimals(),
      vault.symbol(),
      vault.asset(),
      vault.paused(),
      wbtc.decimals(),
      wbtc.symbol(),
    ]);

  const [ta, ts, myShares, myWBTC, alw] = await Promise.all([
    vault.totalAssets(),
    vault.totalSupply(),
    vault.balanceOf(me),
    wbtc.balanceOf(me),
    wbtc.allowance(me, VAULT),
  ]);

  const price =
    ts > 0n
      ? Number(ethers.utils.formatUnits(ta, assetDec)) /
        Number(ethers.utils.formatUnits(ts, shareDec))
      : 1;

  console.log(
    `totalAssets: ${ethers.utils.formatUnits(ta, assetDec)} ${assetSym}`
  );
  console.log(
    `totalSupply: ${ethers.utils.formatUnits(ts, shareDec)} ${shareSym}`
  );
  console.log(`sharePrice:  ${price.toFixed(10)} ${assetSym}/${shareSym}`);
  console.log(
    `myShares:    ${ethers.utils.formatUnits(myShares, shareDec)} ${shareSym}`
  );
  console.log(
    `myWBTC:      ${ethers.utils.formatUnits(myWBTC, assetDec)} ${assetSym}`
  );
  console.log(
    `allowance:   ${ethers.utils.formatUnits(alw, assetDec)} ${assetSym}`
  );

  // Dummy variable for actions
  action = "g";

  if (action === "approve") {
    console.log(`Approving ${assetSym} Max for vault…`);
    const tx = await wbtc.approve(VAULT, MaxUint256);
    console.log("tx:", tx.hash);
    await tx.wait();
    console.log("✅ Approved");
    return;
  }

  if (action === "deposit") {
    const assets = ethers.utils.parseUnits("0.00001", 8); // WBTC has 8 decimals → returns a BigInt
    console.log(assets);
    const tx = await vault.deposit(assets, me);
    console.log("deposit tx:", tx.hash);
    await tx.wait();
    console.log("✅ Deposit done");
    return;
  }

  if (action === "withdraw") {
    const assets = ethers.utils.parseUnits("0.00001", 8); // WBTC has 8 decimals → returns a BigInt
    console.log(assets);
    const tx = await vault.withdraw(assets, me, me);
    console.log("withdraw tx:", tx.hash);
    await tx.wait();
    console.log("✅ Withdraw done");
    return;
  }
}

main();
