// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Vault (ERC-4626)
/// @notice Users deposit WBTC (8 decimals) and receive yWBTC shares 1:1 initially.
/// @dev Share decimals are set to match the asset's decimals (8) to avoid scaling surprises.
contract Vault is ERC20, ERC4626, Ownable, Pausable, ReentrancyGuard {
    constructor(address _wbtc)
        ERC20("yWBTC Vault Share", "yWBTC")
        ERC4626(IERC20Metadata(_wbtc))
        Ownable(msg.sender)
    {}

    /// @dev Make share decimals equal to WBTC (8).
    function decimals()
        public
        view
        override(ERC20, ERC4626)
        returns (uint8)
    {
        return IERC20Metadata(asset()).decimals();
    }

    /* ---------- Safety Controls ---------- */

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /* ---------- ERC-4626 overrides to add pause + reentrancy guard ---------- */

    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        shares = super.deposit(assets, receiver);
    }

    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        assets = super.mint(shares, receiver);
    }

    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        shares = super.withdraw(assets, receiver, owner_);
    }

    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        assets = super.redeem(shares, receiver, owner_);
    }

    /* ---------- Admin Utilities ---------- */

    /// @notice Rescue any ERC20 mistakenly sent to this contract (not the asset).
    function rescue(address token, address to, uint256 amount) external onlyOwner {
        require(token != asset(), "cannot rescue asset");
        IERC20Metadata(token).transfer(to, amount);
    }
}
