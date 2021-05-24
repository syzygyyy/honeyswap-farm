// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

interface IRewardManager {
    function distributeReward(address _referrer, uint256 _amount) external;
    function rebalance() external;
}
