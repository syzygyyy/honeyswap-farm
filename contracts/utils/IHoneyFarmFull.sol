// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "../IHoneyFarm.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

interface IHoneyFarmFull is IHoneyFarm, IERC721 {
    function withdrawRewards(uint256 _depositId) external;
    function withdrawRewardsTo(address _recipient, uint256 _depositId) external;
}
