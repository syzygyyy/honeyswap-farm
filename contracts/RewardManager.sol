// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "./IRewardManager.sol";
import "./IHoneyFarm.sol";

contract RewardManager is IRewardManager, Ownable {
    using SafeMath for uint256;

    uint256 public constant SCALE = 1e18;
    IERC20 public immutable rewardToken;
    uint256 public immutable exchangeRate;

    event MissingReward(address indexed referrer, uint256 owedReward);

    constructor(IERC20 _rewardToken, uint256 _exchangeRate) Ownable() {
        require(_exchangeRate < SCALE, "RR: Invalid reward ratio");
        rewardToken = _rewardToken;
        exchangeRate = _exchangeRate;
    }

    function distributeReward(address _referrer, uint256 _amount)
        external override onlyOwner
    {
        uint256 currentReserves = rewardToken.balanceOf(address(this));
        uint256 reward = _amount.mul(exchangeRate).div(SCALE);
        if (reward <= currentReserves) {
            SafeERC20.safeTransfer(rewardToken, _referrer, reward);
        } else if (currentReserves > 0) {
            SafeERC20.safeTransfer(rewardToken, _referrer, currentReserves);
            emit MissingReward(_referrer,  reward - currentReserves);
        } else {
            emit MissingReward(_referrer, reward);
        }
    }

    function rebalance() external override {
        uint256 rrBalance = rewardToken.balanceOf(address(this));
        address farm = owner();
        uint256 farmBalance = rewardToken.balanceOf(farm);
        uint256 targetRebalanceAmount =
            SCALE.mul(rrBalance).sub(exchangeRate.mul(farmBalance)).div(
                SCALE.add(exchangeRate)
            );
        uint256 rebalanceAmount = Math.min(rrBalance, targetRebalanceAmount);
        IHoneyFarm(farm).depositAdditionalRewards(rebalanceAmount);
    }
}
