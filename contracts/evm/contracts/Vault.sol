// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// Vault (ERC-4626) for WBTC (8 decimals)
// 4626 vault with: pause, global TVL cap, per-user cumulative cap,
// per-tx min deposit, safe rescue, and a keeper-called rebalance().
// When we deploy capital externally to other protocols, totalAssets() includes external NAV.
contract Vault is ERC20, ERC4626, Ownable, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /* ========= Caps & Floors ========= */
    // Global TVL cap in underlying (WBTC units, 8 decimals).
    uint256 public depositCap;

    // Minimum single deposit size (per tx) in underlying (WBTC units, 8 decimals).
    uint256 public depositMin;

    // Per-user cumulative deposit cap in underlying (WBTC units, 8 decimals). 0 = disabled.
    uint256 public perUserDepositCap;

    /* ========= Rebalance config ========= */
    uint16 private constant MAX_BPS = 10_000;

    // Recipient A (e.g., bridge hot wallet → Drift).
    address public recipientA;

    // Recipient B (e.g., Hyperliquid collateral wallet).
    address public recipientB;

    // Split for A in basis points (A gets splitA_BPS, B gets 10000 - splitA_BPS).
    uint16 public splitA_BPS;

    // Minimum amount (in WBTC units) required to call rebalance().
    uint256 public rebalanceMin;

    // Net Asset Value (NAV) of assets held off-contract (sum for A+B), in WBTC units (8 decimals).
    uint256 public externalNav;

    // Allow for difference owner and keeper
    mapping(address => bool) public isKeeper;
    event KeeperSet(address indexed keeper, bool enabled);

    /* ========= Events ========= */
    event DepositCapUpdated(uint256 oldCap, uint256 newCap);
    event DepositMinUpdated(uint256 oldMin, uint256 newMin);
    event PerUserDepositCapUpdated(uint256 oldCap, uint256 newCap);

    event RecipientsUpdated(address recipientA, address recipientB);
    event SplitUpdated(uint16 splitA_BPS);
    event RebalanceMinUpdated(uint256 minAmount);

    event Rebalanced(uint256 amount, uint256 toA, uint256 toB);
    event Rescued(address indexed token, address indexed to, uint256 amount);
    event ExternalNavAdjusted(int256 delta, uint256 newNav);

    /// @param _wbtc  Address of the WBTC-like underlying (8 decimals).
    /// @param _owner Initial owner (admin).
    constructor(address _wbtc, address _owner)
        ERC20("yWBTC Vault Share", "yWBTC")
        ERC4626(IERC20Metadata(_wbtc))
        Ownable(_owner)
    {
        // Defaults: no caps/mins unless set; split 85/15; no recipients set.
        depositCap = type(uint256).max;
        depositMin = 0;
        perUserDepositCap = 0;

        splitA_BPS = 8500; // 85% to A, 15% to B
        rebalanceMin = 0;  // off by default until set
    }

    function setKeeper(address keeper, bool enabled) external onlyOwner {
        isKeeper[keeper] = enabled;
        emit KeeperSet(keeper, enabled);
    }

    modifier onlyKeeperOrOwner() {
        require(isKeeper[msg.sender] || msg.sender == owner(), "not keeper/owner");
        _;
    }

    /// @dev OZ ERC4626 already maps share decimals to the asset's decimals.
    function decimals()
        public
        view
        override(ERC20, ERC4626)
        returns (uint8)
    {
        return IERC20Metadata(asset()).decimals();
    }

    /* ========= Admin (caps & floors) ========= */

    // Set a maximum TVL in the vault (global cap).
    function setDepositCap(uint256 newCap) external onlyOwner {
        uint256 old = depositCap;
        depositCap = newCap;
        emit DepositCapUpdated(old, newCap);
    }

    // Set a minimum single deposit size (per transaction).
    function setDepositMin(uint256 newMin) external onlyOwner {
        uint256 old = depositMin;
        depositMin = newMin;
        emit DepositMinUpdated(old, newMin);
    }

    // Set a per-user cumulative deposit cap. Set to 0 to disable.
    function setPerUserDepositCap(uint256 newCap) external onlyOwner {
        uint256 old = perUserDepositCap;
        perUserDepositCap = newCap;
        emit PerUserDepositCapUpdated(old, newCap);
    }

    /* ========= Admin (rebalance config) ========= */

    // Set wallets A and B
    function setRecipients(address _A, address _B) external onlyOwner {
        require(_A != address(0) && _B != address(0), "zero recipient");
        recipientA = _A;
        recipientB = _B;
        emit RecipientsUpdated(_A, _B);
    }

    // Set ratio to distribute to A and B
    function setSplitBPS(uint16 _splitA_BPS) external onlyOwner {
        require(_splitA_BPS <= MAX_BPS, "split > 100%");
        splitA_BPS = _splitA_BPS;
        emit SplitUpdated(_splitA_BPS);
    }

    // Set the minimum amount required to call rebalance().
    // For WBTC (8 dec): 0.01 WBTC = 1_000_000 (1e6).
    function setRebalanceMin(uint256 minAmount) external onlyOwner {
        rebalanceMin = minAmount;
        emit RebalanceMinUpdated(minAmount);
    }

    // Owner reports new off-chain NAV (in WBTC units, 8 decimals).
    // Call this periodically to reflect PnL from Drift/Hyperliquid legs.
    function adjustExternalNav(int256 delta) external onlyKeeperOrOwner {
        if (delta >= 0) {
            externalNav += uint256(delta);
        } else {
            uint256 abs = uint256(-delta);
            require(abs <= externalNav, "nav underflow");
            externalNav -= abs;
        }
        emit ExternalNavAdjusted(delta, externalNav);
    }
    // Some safety functions
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // Rescue any ERC20 mistakenly sent (not the underlying asset).
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        require(token != asset(), "cannot rescue asset");
        IERC20(token).safeTransfer(to, amount);
        emit Rescued(token, to, amount);
    }

    /* ========= ERC-4626 entrypoints ========= */

    // Deposit function (takes into account min and max)
    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        require(assets >= depositMin, "deposit below minimum");
        require(assets <= maxDeposit(receiver), "exceeds cap");
        shares = super.deposit(assets, receiver);
    }

    // Mint function
    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        uint256 requiredAssets = previewMint(shares);
        require(requiredAssets >= depositMin, "deposit below minimum");
        require(requiredAssets <= maxDeposit(receiver), "exceeds cap");
        assets = super.mint(shares, receiver);
    }

    // Withdraw function
    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        shares = super.withdraw(assets, receiver, owner_);
    }

    // Redeem function
    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        assets = super.redeem(shares, receiver, owner_);
    }

    /* ========= ERC-4626 views (limits) ========= */

    // Max additional assets `receiver` can deposit, combining global TVL + per-user cap.
    function maxDeposit(address receiver) public view override returns (uint256) {
        if (paused()) return 0;

        // Global headroom (uses totalAssets(), which includes externalNav)
        uint256 ta = totalAssets();
        uint256 globalRemaining = ta >= depositCap ? 0 : (depositCap - ta);

        if (perUserDepositCap == 0) return globalRemaining;

        // User exposure in assets (shares → assets at current rate)
        uint256 userAssets = convertToAssets(balanceOf(receiver));
        if (userAssets >= perUserDepositCap) return 0;

        uint256 userRemaining = perUserDepositCap - userAssets;
        return userRemaining < globalRemaining ? userRemaining : globalRemaining;
    }

    // 
    function maxMint(address receiver) public view override returns (uint256) {
        uint256 assetsRoom = maxDeposit(receiver);
        return convertToShares(assetsRoom);
    }

    // For better UX: too-small deposits preview to 0 shares.
    function previewDeposit(uint256 assets) public view override returns (uint256) {
        if (assets < depositMin) return 0;
        return super.previewDeposit(assets);
    }

    /* ========= NAV & idle ========= */

    // Total assets = on-contract WBTC + off-contract NAV.
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this)) + externalNav;
    }

    // WBTC actually sitting in the vault contract.
    function idleAssets() public view returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /* ========= Rebalance ========= */

    // Move `amount` WBTC out of the vault to recipients, split by `splitA_BPS`.
    // Keeper chooses the chunk size. Requires >= rebalanceMin and <= idle.
    // We add `amount` to `externalNav` so share price stays stable.
    function rebalance(uint256 amount) external whenNotPaused nonReentrant onlyKeeperOrOwner {
        require(recipientA != address(0) && recipientB != address(0), "recipients not set");
        require(amount >= rebalanceMin, "below threshold");

        uint256 idle = idleAssets();
        require(amount <= idle, "insufficient idle");

        uint256 toA = (amount * splitA_BPS) / MAX_BPS;
        uint256 toB = amount - toA;

        IERC20(asset()).safeTransfer(recipientA, toA);
        IERC20(asset()).safeTransfer(recipientB, toB);

        // Account the moved assets as off-contract NAV
        externalNav += amount;

        emit Rebalanced(amount, toA, toB);
    }
}
