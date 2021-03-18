// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

contract ReferralRewarder is Ownable {
    using SafeMath for uint256;

    uint256 public constant SCALE = 1 ether;
    IERC20 public immutable rewardToken;
    uint256 public immutable exchangeRate;

    constructor(IERC20 rewardToken_, uint256 exchangeRate_) Ownable() {
        rewardToken = rewardToken_;
        exchangeRate = exchangeRate_;
    }

    function distributeReward(address referrer, uint256 amount) external onlyOwner {
        uint256 reward = amount.mul(exchangeRate).div(SCALE);
        SafeERC20.safeTransfer(rewardToken, referrer, reward);
    }
}
