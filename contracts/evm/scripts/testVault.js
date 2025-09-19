// vault_test.cjs
const path = require("path");
const dotenv = require("dotenv");
const { ethers } = require("ethers");

// Resolve root .env (two levels up; adjust if needed)
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

const DEF_POLL = 10_000;

// ===== Minimal ABIs =====
const vaultAbi = [
  "function asset() view returns (address)",
  "function decimals() view returns (uint8)",
  "function totalAssets() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function idleAssets() view returns (uint256)",

  "function redemptionPeriod() view returns (uint256)",
  "function setRedemptionPeriod(uint256 seconds_) external",
  "function pendingOf(address) view returns (uint256 shares, uint256 unlockAt, uint256 timeLeft)",
  "function pendingShares(address) view returns (uint256)",
  "function pendingUnlockAt(address) view returns (uint256)",
  "function unlockedSharesOf(address) view returns (uint256)",

  "function initiateWithdraw(uint256 shares) external",
  "function cancelWithdraw(uint256 shares) external",
  "function redeem(uint256 shares, address receiver, address owner) external returns (uint256 assets)",
  "function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares)",
  "function maxWithdraw(address owner) view returns (uint256)",
  "function maxRedeem(address owner) view returns (uint256)",

  "function previewRedeem(uint256 shares) view returns (uint256 assets)",
  "function previewWithdraw(uint256 assets) view returns (uint256 shares)",
  "function convertToShares(uint256 assets) view returns (uint256 shares)", // if implemented
];

const erc20Abi = [
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
];

// ===== CLI parsing =====
const args = process.argv.slice(2);
const cmd = (args[0] || "status").toLowerCase();

function getFlag(name, fallback = undefined) {
  const i = args.findIndex((a) => a === `--${name}`);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return fallback;
}

const RPC_URL = getFlag("rpc", process.env.ARBITRUM_ALCHEMY_MAINNET);
const PRIVATE_KEY = getFlag("pk", process.env.WALLET_SECRET);
const VAULT_ADDRESS = (
  getFlag("vault", process.env.VAULT_ADDRESS) || ""
).trim();
const WALLET = process.env.WALLET_ADDRESS;
//const WALLET = process.env.WALLET_RECIPIENT_A;

if (!RPC_URL) throw new Error("Missing RPC_URL (env or --rpc).");
if (!VAULT_ADDRESS) throw new Error("Missing VAULT_ADDRESS (env or --vault).");

const provider = new ethers.JsonRpcProvider(RPC_URL);

// signer is only needed for tx commands; status can run read-only
const signer = PRIVATE_KEY ? new ethers.Wallet(PRIVATE_KEY, provider) : null;

const vaultContract = new ethers.Contract(VAULT_ADDRESS, vaultAbi, signer);

async function main() {
  const redPeriod = await vaultContract.redemptionPeriod();
  console.log("Redemption period in seconds: ", redPeriod);

  const unlockedShares = await vaultContract.unlockedSharesOf(WALLET);
  console.log("Unlocked shares: ", unlockedShares.toString());

  const pendingShares = await vaultContract.pendingShares(WALLET);
  console.log("Pending shares: ", pendingShares.toString());

  // check decimals asset
  const asset = new ethers.Contract(
    await vaultContract.asset(),
    ["function decimals() view returns (uint8)"],
    provider
  );

  const [shareDec, assetDec] = await Promise.all([
    vaultContract.decimals(),
    asset.decimals(),
  ]);

  const [pShares, , tl] = await vaultContract.pendingOf(WALLET);
  const [maxR, maxW, idle, ta, ts] = await Promise.all([
    vaultContract.maxRedeem(WALLET),
    vaultContract.maxWithdraw(WALLET),
    vaultContract.idleAssets(),
    vaultContract.totalAssets(),
    vaultContract.totalSupply(),
  ]);

  const assetsFromPending = await vaultContract.previewRedeem(pShares);

  console.log("shareDec:", Number(shareDec), "assetDec:", Number(assetDec));
  console.log("pendingShares:", pShares.toString(), "timeLeft:", tl.toString());
  console.log(
    "previewRedeem(pendingShares):",
    ethers.formatUnits(assetsFromPending, assetDec)
  );
  console.log("idleAssets():", ethers.formatUnits(idle, assetDec));
  console.log("maxRedeem(owner):", maxR.toString());
  console.log("maxWithdraw(owner):", ethers.formatUnits(maxW, assetDec));
  console.log(
    "totalAssets:",
    ethers.formatUnits(ta, assetDec),
    "totalSupply:",
    ts.toString()
  );

  // Cancel withdraw
  //tx = await vaultContract.connect(signer).cancelWithdraw(shares);

  // Set redemption period
  //const tx1 = await vaultContract.connect(signer).setRedemptionPeriod(600);

  // Initiate withdraw
  //const tx2 = await vaultContract.connect(signer).initiateWithdraw(2);

  // Before maturity: maxWithdraw/maxRedeem should be 0
  const maxWithdraw = await vaultContract.maxWithdraw(WALLET);
  const maxRedeem = await vaultContract.maxRedeem(WALLET);
  console.log("MaxWithdraw:", maxWithdraw);

  // const wTx = await vaultContract.withdraw(maxWithdraw, WALLET, WALLET);
  // await wTx.wait();
}

main();
