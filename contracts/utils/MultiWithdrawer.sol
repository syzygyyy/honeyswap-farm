// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "./IHoneyFarmFull.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";

contract MultiWithdrawer {
    using SafeERC20 for IERC20;

    IHoneyFarmFull public immutable farm;
    IERC20 public immutable rewardToken;

    constructor(IHoneyFarmFull _farm, IERC20 _rewardToken) {
        farm = _farm;
        rewardToken = _rewardToken;
    }

    function withdrawRewardsFrom(uint256[] calldata _depositIds) external {
        uint256 depositIdCount = _depositIds.length;
        for (uint256 i; i < depositIdCount; i++) {
            uint256 depositId = _depositIds[i];
            require(farm.ownerOf(depositId) == msg.sender, "MultiWithdrawer: Not owner");
            farm.withdrawRewards(depositId);
        }
        uint256 availableRewards = rewardToken.balanceOf(address(this));
        rewardToken.safeTransfer(msg.sender, availableRewards);
    }
}
