// SPDX-License-Identifier: GPL-3.0-only
pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./ReferralRewarder.sol";

// Forked from sushiswap's MasterChef contract
contract HoneyFarm is Ownable, ERC721 {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    // Info of each deposit
    struct DepositInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt (value of accumulator)
        uint256 unlockTime;
        uint256 rewardShare;
        uint256 setRewards;
        IERC20 pool;
        address referrer;
    }

    // Info of each pool.
    struct PoolInfo {
        uint256 allocation; // How many allocation points assigned to this pool.
        /* Last block timestamp that HSFs distribution occured, initially set
           to the startTime. */
        uint256 lastRewardTimestamp;
        uint256 accHsfPerShare; // Accumulated HSFs per share, times SCALE.
        uint256 totalShares; // total shares stored in pool
    }

    // What fractional numbers are scaled by
    uint256 public constant SCALE = 1e18;
    // The HoneySwap Farm token
    IERC20 public immutable hsf;
    // referral points token to keep track of referrals
    ReferralRewarder public referralRewarder;
    // Info of each pool.
    mapping(IERC20 => PoolInfo) public poolInfo;
    // set of running pools
    EnumerableSet.AddressSet internal pools;
    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocationPoints;
    // total deposits
    uint256 public totalDeposits;
    // data about infdividual deposits
    mapping(uint256 => DepositInfo) public depositInfo;
    // the negative slope of the distribution line scaled by SCALE, how much
    // less is being distributed per unit of time.
    uint256 public immutable distributionSlope;
    // starting distribution rate / unit time scaled by SCALE
    uint256 public immutable startDistribution;
    // minimum time someone can lock their liquidity for
    uint256 public immutable minTimeLock;
    // maximum time someone can lock their liquidity for
    uint256 public immutable maxTimeLock;
    // time at which coins begin being distributed
    uint256 public immutable startTime;
    // time at which coins finish being distributed
    uint256 public immutable endTime;
    // multiplier for time locked deposits / second locked scaled by SCALE
    uint256 public immutable timeLockMultiplier;
    // constant added to the timeLockMultiplier scaled by SCALE
    uint256 public immutable timeLockConstant;
    // whether this contract has been disabled
    uint256 public contractDisabledAt;

    event PoolAdded(IERC20 indexed poolToken, uint256 allocation);
    /* fired when pool parameters are updated not when the updatePool() method
       is called */
    event PoolUpdated(IERC20 indexed poolToken, uint256 allocation);
    event Disabled();
    event DepositDowngraded(address indexed downgrader, uint256 depositId);
    event Referred(address indexed referrer, uint256 depositId);

    // parameters passed as byte strings to mitigate stack too deep error
    constructor(
        // IERC20 _hsf,
        // uint256 _totalHsfToDistribute,
        // uint256 _startTime,
        // uint256 _endTime,
        // uint256 _endDistributionFraction,
        bytes memory _disitributionParameters,
        // uint256 _minTimeLock,
        // uint256 _maxTimeLock,
        // uint256 _timeLockMultiplier,
        // uint256 _timeLockConstant
        bytes memory _depositParameters
    ) ERC721("HoneyFarm Deposits v1", "HFD") {
        (
            address _hsfAddress,
            uint256 _totalHsfToDistribute,
            uint256 _startTime,
            uint256 _endTime,
            uint256 _endDistributionFraction
        ) = abi.decode(_disitributionParameters, (
            address, uint256, uint256, uint256, uint256
        ));
        require(_endTime > _startTime, "HF: endTime before startTime");
        IERC20 _hsf = IERC20(_hsfAddress);
        hsf = _hsf;
        startTime = _startTime;
        endTime = _endTime;
        _hsf.safeTransferFrom(msg.sender, address(this), _totalHsfToDistribute);

        /* check readme at github.com/1Hive/honeyswap-farm for a breakdown of
           the maths */
        // ds = (2 * s) / (te * (r + 1))
        uint256 startDistribution_ = _totalHsfToDistribute
            .mul(2)
            .mul(SCALE)
            .mul(SCALE)
            .div(
                (_endTime - _startTime).mul(_endDistributionFraction.add(SCALE))
            );
        // -m = ds * (1 - r) / te
        distributionSlope = startDistribution_
            .mul(SCALE.sub(_endDistributionFraction))
            .div((_endTime - _startTime).mul(SCALE));
        startDistribution = startDistribution_;

        (
            uint256 _minTimeLock,
            uint256 _maxTimeLock,
            uint256 _timeLockMultiplier,
            uint256 _timeLockConstant
        ) = abi.decode(_depositParameters, (uint256, uint256, uint256, uint256));
        minTimeLock = _minTimeLock;
        maxTimeLock = _maxTimeLock;
        timeLockMultiplier = _timeLockMultiplier;
        timeLockConstant = _timeLockConstant;
    }

    modifier notDisabled {
        require(contractDisabledAt == 0, "HF: Contract already disabled");
        _;
    }

    function poolLength() external view returns (uint256) {
        return pools.length();
    }

    function getPoolByIndex(uint256 _index)
        external
        view
        returns(
            IERC20 poolToken,
            uint256 allocation,
            uint256 lastRewardTimestamp,
            uint256 accHsfPerShare,
            uint256 totalShares
        )
    {
        poolToken = IERC20(pools.at(_index));
        PoolInfo storage pool = poolInfo[poolToken];
        allocation = pool.allocation;
        lastRewardTimestamp = pool.lastRewardTimestamp;
        accHsfPerShare = pool.accHsfPerShare;
        totalShares = pool.totalShares;
    }

    // underscore placed after to avoid collide with the ERC721._baseURI property
    function setBaseURI(string memory baseURI_) external onlyOwner {
        _setBaseURI(baseURI_);
    }

    function disableContract(address _tokenRecipient)
        external
        onlyOwner
        notDisabled
    {
        massUpdatePools();
        uint256 remainingTokens = getDistribution(block.timestamp, endTime);
        _safeHsfTransfer(_tokenRecipient, remainingTokens.div(SCALE));
        contractDisabledAt = block.timestamp;
        emit Disabled();
    }

    // Add a new lp to the pool. Can only be called by the owner.
    function add(
        IERC20 _lpToken,
        uint256 _allocation
    ) public onlyOwner notDisabled {
        require(
            address(referralRewarder) != address(0),
            "HF: Referral not setup yet"
        );
        massUpdatePools();
        require(pools.add(address(_lpToken)), "HF: LP pool already exists");
        uint256 lastRewardTimestamp = Math.max(block.timestamp, startTime);
        totalAllocationPoints = totalAllocationPoints.add(_allocation);
        poolInfo[_lpToken] = PoolInfo({
            allocation: _allocation,
            lastRewardTimestamp: lastRewardTimestamp,
            accHsfPerShare: 0,
            totalShares: 0
        });
        emit PoolAdded(_lpToken, _allocation);
    }

    // Update the given pool's allocation point. Can only be called by the owner.
    function set(
        IERC20 _poolToken,
        uint256 _allocation
    ) public onlyOwner notDisabled {
        require(pools.contains(address(_poolToken)), "HF: Non-existant pool");
        massUpdatePools();
        totalAllocationPoints = totalAllocationPoints
            .sub(poolInfo[_poolToken].allocation)
            .add(_allocation);
        poolInfo[_poolToken].allocation = _allocation;
        emit PoolUpdated(_poolToken, _allocation);
    }

    // get tokens to be distributed between two timestamps scaled by SCALE
    function getDistribution(uint256 _from, uint256 _to)
        public
        view
        returns (uint256)
    {
        uint256 from = Math.max(startTime, _from);
        uint256 to = Math.min(_to, contractDisabledAt == 0 ? endTime : contractDisabledAt);

        if (from > to) return uint256(0);

        from = from.sub(startTime);
        to = to.sub(startTime);

        /* check readme at github.com/1Hive/honeyswap-farm for a breakdown of
           the maths */
        // d(t1, t2) = (t2 - t1) * (2 * ds - (-m) * (t2 + t1)) / 2
        return to.sub(from).mul(
            startDistribution.mul(2).sub(distributionSlope.mul(from.add(to)))
        ) / 2;
    }

    function getTimeMultiple(uint256 _unlockTime) public view returns(uint256) {
        if (_unlockTime == 0) return SCALE;
        uint256 timeDelta = _unlockTime.sub(block.timestamp);
        return timeDelta.mul(timeLockMultiplier).add(timeLockConstant);
    }

    // View function to see pending HSFs on frontend.
    function pendingHsf(uint256 _depositId)
        external
        view
        returns (uint256)
    {
        DepositInfo storage deposit = depositInfo[_depositId];
        PoolInfo storage pool = poolInfo[deposit.pool];
        return _getPendingHsf(deposit, pool);
    }

    // Deposit LP tokens into the farm to earn HSF
    function createDeposit(
        IERC20 _poolToken,
        uint256 _amount,
        uint256 _unlockTime,
        address _referrer
    )
        external notDisabled
    {
        require(_amount > 0, "HF: Must deposit something");
        require(_unlockTime <= endTime, "HF: Unlock time after reward end");
        require(
            _unlockTime == 0 || _unlockTime > block.timestamp,
            "HF: Invalid unlock time"
        );
        require(pools.contains(address(_poolToken)), "HF: Non-existant pool");
        if (_unlockTime != 0) {
            uint256 lockDuration = _unlockTime.sub(block.timestamp);
            require(minTimeLock <= lockDuration, "HF: Lock time too short");
            require(lockDuration <= maxTimeLock, "HF: Lock time exceeds maximum");
        }
        PoolInfo storage pool = poolInfo[_poolToken];
        updatePool(_poolToken);
        _poolToken.safeTransferFrom(
            address(msg.sender),
            address(this),
            _amount
        );
        uint256 newDepositId = totalDeposits++;
        DepositInfo storage newDeposit = depositInfo[newDepositId];
        newDeposit.amount = _amount;
        newDeposit.pool = _poolToken;
        newDeposit.referrer = _referrer;
        _resetRewardAccs(newDeposit, pool, _amount, _unlockTime);
        _safeMint(msg.sender, newDepositId);

        if (_referrer != address(0)) {
            emit Referred(_referrer, newDepositId);
        }
    }

    // Withdraw LP tokens from HoneyFarm along with reward
    function closeDeposit(uint256 _depositId) external {
        require(ownerOf(_depositId) == msg.sender, "HF: Must be owner to withdraw");
        DepositInfo storage deposit = depositInfo[_depositId];
        require(
            deposit.unlockTime == 0 ||
            deposit.unlockTime <= block.timestamp ||
            contractDisabledAt > 0,
            "HF: Deposit still locked"
        );
        IERC20 poolToken = deposit.pool;
        PoolInfo storage pool = poolInfo[poolToken];
        updatePool(poolToken);

        uint256 pending = _getPendingHsf(deposit, pool);
        pool.totalShares = pool.totalShares.sub(deposit.rewardShare);
        _burn(_depositId);
        _rewardReferrer(deposit.referrer, pending);
        _safeHsfTransfer(msg.sender, pending);
        poolToken.safeTransfer(msg.sender, deposit.amount);
    }

    function setReferralRewarder(address _referralRewarder) external onlyOwner {
        require(address(referralRewarder) == address(0), "HF: HRP already set");
        require(
            Ownable(_referralRewarder).owner() == address(this),
            "HF: Not yet owner of HRP"
        );
        referralRewarder = ReferralRewarder(_referralRewarder);
    }

    function withdrawRewards(uint256 depositId) external {
        require(ownerOf(depositId) == msg.sender, "HF: Must be owner of deposit");
        DepositInfo storage deposit = depositInfo[depositId];
        PoolInfo storage pool = poolInfo[deposit.pool];
        uint256 _unlockTime = deposit.unlockTime;
        if (_unlockTime > 0 && _unlockTime <= block.timestamp) {
            _downgradeExpired(depositId);
        } else {
            updatePool(deposit.pool);
        }
        uint256 pendingRewards = _getPendingHsf(deposit, pool);
        deposit.setRewards = uint256(0);
        deposit.rewardDebt = deposit.rewardShare.mul(pool.accHsfPerShare).div(SCALE);
        _rewardReferrer(deposit.referrer, pendingRewards);
        _safeHsfTransfer(msg.sender, pendingRewards);
    }

    function downgradeExpired(uint256 _depositId) public {
        DepositInfo storage deposit = depositInfo[_depositId];
        require(deposit.unlockTime > 0, "HF: no lock to expire");
        require(
            deposit.unlockTime <= block.timestamp,
            "HF: deposit has not expired yet"
        );
        _downgradeExpired(_depositId);
    }

    // Update reward variables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = pools.length();
        for (uint256 pid = 0; pid < length; pid++) {
            updatePool(IERC20(pools.at(pid)));
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(IERC20 _poolToken) public {
        PoolInfo storage pool = poolInfo[_poolToken];
        if (block.timestamp <= pool.lastRewardTimestamp) {
            return;
        }
        uint256 totalShares = pool.totalShares;
        if (totalShares == 0) {
            pool.lastRewardTimestamp = block.timestamp;
            return;
        }
        uint256 dist = getDistribution(pool.lastRewardTimestamp, block.timestamp);
        uint256 hsfReward = dist.mul(pool.allocation).div(totalAllocationPoints);
        uint256 poolScaledRewards = hsfReward.div(totalShares);
        pool.accHsfPerShare = pool.accHsfPerShare.add(poolScaledRewards);
        pool.lastRewardTimestamp = block.timestamp;
    }

    function _rewardReferrer(address _referrer, uint256 _reward) internal {
        if (_referrer != address(0)) {
            referralRewarder.distributeReward(_referrer, _reward);
        }
    }

    function _downgradeExpired(uint256 _depositId) internal {
        DepositInfo storage deposit = depositInfo[_depositId];
        IERC20 poolToken = deposit.pool;
        PoolInfo storage pool = poolInfo[poolToken];
        updatePool(poolToken);
        deposit.setRewards = _getPendingHsf(deposit, pool);
        _resetRewardAccs(deposit, pool, deposit.amount, 0);
        emit DepositDowngraded(msg.sender, _depositId);
    }

    function _getPendingHsf(
        DepositInfo storage _deposit,
        PoolInfo storage _pool
    )
        internal
        view
        returns(uint256)
    {
        uint256 accHsfPerShare = _pool.accHsfPerShare;
        uint256 totalShares = _pool.totalShares;
        if (block.timestamp > _pool.lastRewardTimestamp && totalShares != 0) {
            uint256 dist = getDistribution(_pool.lastRewardTimestamp, block.timestamp);
            uint256 hsfReward = dist.mul(_pool.allocation).div(totalAllocationPoints);
            accHsfPerShare = accHsfPerShare.add(hsfReward.div(totalShares));
        }
        return _deposit.rewardShare.mul(accHsfPerShare).div(SCALE).sub(
            _deposit.rewardDebt
        ).add(_deposit.setRewards);
    }

    function _resetRewardAccs(
        DepositInfo storage _deposit,
        PoolInfo storage _pool,
        uint256 _amount,
        uint256 _unlockTime
    )
        internal
    {
        _deposit.unlockTime = _unlockTime;
        uint256 newShares = _amount.mul(getTimeMultiple(_unlockTime)).div(SCALE);
        _deposit.rewardDebt = newShares.mul(_pool.accHsfPerShare).div(SCALE);
        _pool.totalShares = _pool.totalShares.sub(_deposit.rewardShare).add(newShares);
        _deposit.rewardShare = newShares;
    }

    /* Safe hsf transfer function, just in case if rounding error causes pool
       to not have enough HSFs. */
    function _safeHsfTransfer(address _to, uint256 _amount) internal {
        uint256 hsfBal = hsf.balanceOf(address(this));
        hsf.transfer(_to, Math.min(_amount, hsfBal));
    }
}
