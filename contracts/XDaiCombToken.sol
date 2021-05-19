// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract XDaiCombToken is ERC20 {
    constructor() ERC20("HoneySwap Farm token", "xCOMB") {
        // 1 million initial supply
        _mint(msg.sender, 10**6 * 1e18);
    }
}
