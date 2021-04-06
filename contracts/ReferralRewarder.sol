// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";

contract ReferralRewarder is Ownable {
    using SafeMath for uint256;

    uint256 public constant SCALE = 1e18;
    IERC20 public immutable rewardToken;
    uint256 public immutable exchangeRate;

    event MissingReward(address indexed referrer, uint256 owedReward);

    constructor(IERC20 _rewardToken, uint256 _exchangeRate) Ownable() {
        rewardToken = _rewardToken;
        exchangeRate = _exchangeRate;
    }

    function distributeReward(address _referrer, uint256 _amount) external onlyOwner {
        uint256 currentReserves = rewardToken.balanceOf(address(this));
        uint256 reward = _amount.mul(exchangeRate).div(SCALE);
        if (reward <= currentReserves) {
            SafeERC20.safeTransfer(rewardToken, _referrer, reward);
        } else if (currentReserves > 0) {
            SafeERC20.safeTransfer(rewardToken, _referrer, currentReserves);
            emit MissingReward(_referrer, currentReserves - reward);
        } else {
            emit MissingReward(_referrer, reward);
        }
    }
}
