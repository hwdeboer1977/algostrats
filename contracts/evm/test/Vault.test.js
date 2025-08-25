const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Vault (ERC-4626)", function () {
  const D = (n) => ethers.parseUnits(n.toString(), 8); // WBTC has 8 decimals

  let deployer, user;
  let wbtc, vault;

  beforeEach(async () => {
    [deployer, user] = await ethers.getSigners();

    const MockWBTC = await ethers.getContractFactory("MockWBTC");
    wbtc = await MockWBTC.deploy();
    await wbtc.waitForDeployment();

    const VaultWBTC = await ethers.getContractFactory("Vault");
    vault = await VaultWBTC.deploy(await wbtc.getAddress());
    await vault.waitForDeployment();

    // Fund user with 1.5 WBTC
    await wbtc.mint(user.address, D(1.5));
  });

  it("uses 8 decimals for shares", async () => {
    expect(await wbtc.decimals()).to.eq(8);
    expect(await vault.decimals()).to.eq(8);
  });

  it("deposit mints shares 1:1 initially", async () => {
    const amount = D(1);

    await wbtc.connect(user).approve(await vault.getAddress(), amount);
    const shares = await vault
      .connect(user)
      .deposit.staticCall(amount, user.address);
    expect(shares).to.eq(amount);

    await vault.connect(user).deposit(amount, user.address);

    expect(await vault.balanceOf(user.address)).to.eq(amount);
    expect(await vault.totalAssets()).to.eq(amount);
    expect(await vault.totalSupply()).to.eq(amount);
  });

  it("withdraw burns proportional shares", async () => {
    const amount = D(1);
    await wbtc.connect(user).approve(await vault.getAddress(), amount);
    await vault.connect(user).deposit(amount, user.address);

    // Withdraw 0.4 WBTC
    const toWithdraw = D(0.4);
    const sharesNeeded = await vault.convertToShares(toWithdraw);

    const balBefore = await wbtc.balanceOf(user.address);
    await vault.connect(user).withdraw(toWithdraw, user.address, user.address);
    const balAfter = await wbtc.balanceOf(user.address);

    expect(balAfter - balBefore).to.eq(toWithdraw);
    expect(await vault.balanceOf(user.address)).to.eq(amount - sharesNeeded);
    expect(await vault.totalAssets()).to.eq(amount - toWithdraw);
  });

  it("pause blocks deposits/mints", async () => {
    await vault.connect(deployer).pause();

    await wbtc.connect(user).approve(await vault.getAddress(), D(0.1));
    await expect(
      vault.connect(user).deposit(D(0.1), user.address)
    ).to.be.revertedWithCustomError(vault, "EnforcedPause");
  });
});
