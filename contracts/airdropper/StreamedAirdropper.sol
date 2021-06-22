// SPDX-License-Identifier: GPL-3.0-only
pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "./IStreamedAirdropper.sol";

contract StreamedAirdropper is IStreamedAirdropper {
    using SafeERC20 for IERC20;
    using SafeMath for uint256;

    struct Vesting {
        uint256 amountLeft;
        uint256 lastWithdraw;
    }

    mapping(address => Vesting) public vestingUsers;

    IERC20 public immutable token;
    uint256 public immutable distributionStart;
    uint256 public immutable distributionEnd;

    event VestingAdded(address indexed user, uint256 amount);
    event Withdraw(
        address indexed user,
        address indexed recipient,
        uint256 withdrawAmount
    );

    constructor(
        IERC20 _token,
        uint256 _distributionStart,
        uint256 _distributionEnd
    ) {
        require(
            block.timestamp <= _distributionStart &&
            _distributionStart < _distributionEnd,
            "SA: Invalid distribution time"
        );
        token = _token;
        distributionStart = _distributionStart;
        distributionEnd = _distributionEnd;
    }

    function addVesting(address _user, uint256 _amount) external override {
        Vesting storage userVesting = vestingUsers[_user];
        userVesting.amountLeft = userVesting.amountLeft.add(_amount);
        token.safeTransferFrom(msg.sender, address(this), _amount);
        emit VestingAdded(_user, _amount);
    }

    function withdraw() external {
        _withdrawTokensTo(msg.sender);
    }

    function withdrawTo(address _recipient) external {
        _withdrawTokensTo(_recipient);
    }

    function pendingTokens(address _user) public view returns (uint256) {
        Vesting storage userVesting = vestingUsers[_user];
        uint256 amountLeft = userVesting.amountLeft;
        uint256 realLastWithdraw = userVesting.lastWithdraw;
        if (
            amountLeft == 0 ||
            realLastWithdraw >= distributionEnd ||
            block.timestamp <= distributionStart
        ) return 0;

        uint256 lastWithdraw = Math.max(distributionStart, realLastWithdraw);
        uint256 currentTime = Math.min(distributionEnd, block.timestamp);
        uint256 elapsedTime = currentTime.sub(lastWithdraw);
        uint256 remainingTime = distributionEnd.sub(lastWithdraw);
        return amountLeft.mul(elapsedTime).div(remainingTime);
    }

    function _withdrawTokensTo(address _recipient) internal {
        uint256 pendingTokens_ = pendingTokens(msg.sender);
        require(pendingTokens_ > 0, "SA: No pending tokens");
        Vesting storage userVesting = vestingUsers[msg.sender];
        userVesting.lastWithdraw = block.timestamp;
        userVesting.amountLeft = userVesting.amountLeft.sub(pendingTokens_);
        token.safeTransfer(_recipient, pendingTokens_);
        emit Withdraw(msg.sender, _recipient, pendingTokens_);
    }
}
