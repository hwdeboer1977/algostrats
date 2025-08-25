// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockWBTC is ERC20 {
    constructor() ERC20("Wrapped Bitcoin", "WBTC") {}
    function decimals() public pure override returns (uint8) { return 8; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
