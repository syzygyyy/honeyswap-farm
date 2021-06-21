// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

interface IStreamedAirdropper {
    function addVesting(address _user, uint256 _amount) external;
}
