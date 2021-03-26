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
        uint256 allocPoint; // How many allocation points assigned to this pool.
        /* Last block timestamp that HSFs distribution occured, initially set
           to the startTime. */
        uint256 lastRewardTimestamp;
        uint256 accHsfPerShare; // Accumulated HSFs per share, times SCALE.
        uint256 totalShares; // total shares stored in pool
    }

    // What fractional numbers are scaled by
    uint256 public constant SCALE = 1 ether;
    // The HoneySwap Farm token
    IERC20 public immutable hsf;
    // referral points token to keep track of referrals
    ReferralRewarder public referralRewarder;
    // Info of each pool.
    mapping(IERC20 => PoolInfo) public poolInfo;
    // set of running pools
    EnumerableSet.AddressSet internal _pools;
    // Total allocation poitns. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint;
    // total deposits
    uint256 public totalDeposits;
    // data about infdividual deposits
    mapping(uint256 => DepositInfo) public depositInfo;
    // the negative slope of the distribution line scaled by SCALE, how much
    // less is being distributed per unit of time.
    uint256 public immutable distSlope;
    // starting distribution rate / unit time scaled by SCALE
    uint256 public immutable startDist;
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
    bool public contractDisabled;

    event PoolAdded(IERC20 indexed poolToken, uint256 allocPoint);
    /* fired when pool parameters are updated not when the updatePool() method
       is called */
    event PoolUpdated(IERC20 indexed poolToken, uint256 allocPoint);
    event Disabled();
    event DepositDowngraded(address indexed downgrader, uint256 depositId);
    event Referred(address indexed referrer, uint256 depositId);

    constructor(
        IERC20 hsf_,
        uint256 totalHsfToDist,
        uint256 startTime_,
        uint256 endTime_,
        /* End distribution fraction:
           represents how much less tokens to distribute at the end vs the
           beginning scaled by SCALE. If it's 0.2 * SCALE then 80% less tokens
           will be distributed per unit of time at the end vs beginning */
        uint256 endDistFrac,
        uint256 maxTimeLock_,
        uint256 timeLockMultiplier_,
        uint256 timeLockConstant_
    ) ERC721("HoneyFarm Deposits v1", "HFD") {
        require(endTime_ > startTime_, "HF: endTime before startTime");
        hsf = hsf_;
        startTime = startTime_;
        endTime = endTime_;
        maxTimeLock = maxTimeLock_;
        timeLockMultiplier = timeLockMultiplier_;
        timeLockConstant = timeLockConstant_;
        hsf_.safeTransferFrom(msg.sender, address(this), totalHsfToDist);

        /* check readme at github.com/1Hive/honeyswap-farm for a breakdown of
           the maths */
        // ds = (2 * s) / (te * (r + 1))
        uint256 startDist_ = totalHsfToDist.mul(2).mul(SCALE).mul(SCALE).div(
            (endTime_ - startTime_).mul(endDistFrac.add(SCALE))
        );
        // -m = ds * (1 - r) / te
        distSlope = startDist_.mul(SCALE.sub(endDistFrac)).div(
            (endTime_ - startTime_).mul(SCALE)
        );
        startDist = startDist_;
    }

    modifier notDisabled {
        require(!contractDisabled, "HF: Contract already disabled");
        _;
    }

    function poolLength() external view returns (uint256) {
        return _pools.length();
    }

    function getPoolByIndex(uint256 index)
        external
        view
        returns(
            IERC20 poolToken,
            uint256 allocPoint,
            uint256 lastRewardTimestamp,
            uint256 accHsfPerShare,
            uint256 totalShares
        )
    {
        poolToken = IERC20(_pools.at(index));
        PoolInfo storage pool = poolInfo[poolToken];
        allocPoint = pool.allocPoint;
        lastRewardTimestamp = pool.lastRewardTimestamp;
        accHsfPerShare = pool.accHsfPerShare;
        totalShares = pool.totalShares;
    }

    function disableContract(address tokenRecipient)
        external
        onlyOwner
        notDisabled
    {
        massUpdatePools();
        uint256 remainingTokens = getDist(block.timestamp, endTime);
        _safeHsfTransfer(tokenRecipient, remainingTokens.div(SCALE));
        contractDisabled = true;
        emit Disabled();
    }

    // Add a new lp to the pool. Can only be called by the owner.
    function add(
        uint256 allocPoint,
        IERC20 lpToken
    ) public onlyOwner notDisabled {
        require(
            address(referralRewarder) != address(0),
            "HF: Referral not setup yet"
        );
        massUpdatePools();
        uint256 lastRewardTimestamp = Math.max(block.timestamp, startTime);
        totalAllocPoint = totalAllocPoint.add(allocPoint);
        require(_pools.add(address(lpToken)), "HF: LP pool already exists");
        poolInfo[lpToken] = PoolInfo({
            allocPoint: allocPoint,
            lastRewardTimestamp: lastRewardTimestamp,
            accHsfPerShare: 0,
            totalShares: 0
        });
        emit PoolAdded(lpToken, allocPoint);
    }

    // Update the given pool's SUSHI allocation point. Can only be called by the owner.
    function set(
        IERC20 poolToken,
        uint256 allocPoint
    ) public onlyOwner notDisabled {
        massUpdatePools();
        totalAllocPoint = totalAllocPoint.sub(poolInfo[poolToken].allocPoint).add(
            allocPoint
        );
        poolInfo[poolToken].allocPoint = allocPoint;
        emit PoolUpdated(poolToken, allocPoint);
    }

    // get tokens to be distributed between two timestamps scaled by SCALE
    function getDist(uint256 from, uint256 to)
        public
        view
        returns (uint256)
    {
        from = Math.max(startTime, from);
        to = Math.min(to, endTime);

        if (from > to) return uint256(0);

        from = from.sub(startTime);
        to = to.sub(startTime);

        /* check readme at github.com/1Hive/honeyswap-farm for a breakdown of
           the maths */
        // d(t1, t2) = (t2 - t1) * (2 * ds - (-m) * (t2 + t1)) / 2
        return to.sub(from).mul(
            startDist.mul(2).sub(distSlope.mul(from.add(to)))
        ).div(2);
    }

    function getTimeMultiple(uint256 unlockTime) public view returns(uint256) {
        if (unlockTime == 0) return SCALE;
        uint256 timeDelta = unlockTime.sub(block.timestamp);
        return timeDelta.mul(timeLockMultiplier).add(timeLockConstant);
    }

    // View function to see pending HSFs on frontend.
    function pendingHsf(uint256 depositId)
        external
        view
        returns (uint256)
    {
        DepositInfo storage deposit = depositInfo[depositId];
        PoolInfo storage pool = poolInfo[deposit.pool];
        return _getPendingHsf(deposit, pool);
    }

    // Deposit LP tokens into the farm to earn HSF
    function createDeposit(
        IERC20 poolToken,
        uint256 amount,
        uint256 unlockTime,
        address referrer
    )
        external notDisabled
    {
        require(
            unlockTime == 0 || unlockTime > block.timestamp,
            "HF: Invalid unlock time"
        );
        require(_pools.contains(address(poolToken)), "HF: Non-existant pool");
        require(
            unlockTime == 0 || unlockTime.sub(block.timestamp) <= maxTimeLock,
            "HF: Lock time exceeds maximum"
        );
        PoolInfo storage pool = poolInfo[poolToken];
        updatePool(poolToken);
        poolToken.safeTransferFrom(
            address(msg.sender),
            address(this),
            amount
        );
        uint256 newDepositId = totalDeposits++;
        DepositInfo storage newDeposit = depositInfo[newDepositId];
        newDeposit.amount = amount;
        newDeposit.pool = poolToken;
        newDeposit.referrer = referrer;
        _resetRewardAccs(newDeposit, pool, amount, unlockTime);
        _safeMint(msg.sender, newDepositId);

        if (referrer != address(0)) {
            emit Referred(referrer, newDepositId);
        }
    }

    // Withdraw LP tokens from HoneyFarm along with reward
    function closeDeposit(uint256 depositId) external {
        require(ownerOf(depositId) == msg.sender, "HF: Must be owner to withdraw");
        DepositInfo storage deposit = depositInfo[depositId];
        require(
            deposit.unlockTime == 0 ||
            deposit.unlockTime <= block.timestamp ||
            contractDisabled,
            "HF: Deposit still locked"
        );
        IERC20 poolToken = deposit.pool;
        PoolInfo storage pool = poolInfo[poolToken];
        updatePool(poolToken);

        uint256 pending = _getPendingHsf(deposit, pool);
        pool.totalShares = pool.totalShares.sub(deposit.rewardShare);
        _burn(depositId);
        _rewardReferrer(deposit.referrer, pending);
        _safeHsfTransfer(msg.sender, pending);
        poolToken.safeTransfer(msg.sender, deposit.amount);
    }

    function setReferralRewarder(address referralRewarder_) external onlyOwner {
        require(address(referralRewarder) == address(0), "HF: HRP already set");
        require(
            Ownable(referralRewarder_).owner() == address(this),
            "HF: Not yet owner of HRP"
        );
        referralRewarder = ReferralRewarder(referralRewarder_);
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

    function downgradeExpired(uint256 depositId) public {
        DepositInfo storage deposit = depositInfo[depositId];
        require(deposit.unlockTime > 0, "HF: no lock to expire");
        require(
            deposit.unlockTime <= block.timestamp,
            "HF: deposit has not expired yet"
        );
        _downgradeExpired(depositId);
    }

    // Update reward vairables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = _pools.length();
        for (uint256 pid = 0; pid < length; pid++) {
            updatePool(IERC20(_pools.at(pid)));
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(IERC20 poolToken) public {
        PoolInfo storage pool = poolInfo[poolToken];
        if (block.timestamp <= pool.lastRewardTimestamp) {
            return;
        }
        uint256 totalShares = pool.totalShares;
        if (totalShares == 0) {
            pool.lastRewardTimestamp = block.timestamp;
            return;
        }
        uint256 dist = getDist(pool.lastRewardTimestamp, block.timestamp);
        uint256 hsfReward = dist.mul(pool.allocPoint).div(totalAllocPoint);
        uint256 poolScaledRewards = hsfReward.div(totalShares);
        pool.accHsfPerShare = pool.accHsfPerShare.add(poolScaledRewards);
        pool.lastRewardTimestamp = block.timestamp;
    }

    function _rewardReferrer(address referrer, uint256 reward) internal {
        if (referrer != address(0)) {
            referralRewarder.distributeReward(referrer, reward);
        }
    }

    function _downgradeExpired(uint256 depositId) internal {
        DepositInfo storage deposit = depositInfo[depositId];
        IERC20 poolToken = deposit.pool;
        PoolInfo storage pool = poolInfo[poolToken];
        updatePool(poolToken);
        deposit.setRewards = _getPendingHsf(deposit, pool);
        _resetRewardAccs(deposit, pool, deposit.amount, 0);
        emit DepositDowngraded(msg.sender, depositId);
    }

    function _getPendingHsf(
        DepositInfo storage deposit,
        PoolInfo storage pool
    )
        internal
        view
        returns(uint256)
    {
        uint256 accHsfPerShare = pool.accHsfPerShare;
        uint256 totalShares = pool.totalShares;
        if (block.timestamp > pool.lastRewardTimestamp && totalShares != 0) {
            uint256 dist = getDist(pool.lastRewardTimestamp, block.timestamp);
            uint256 hsfReward = dist.mul(pool.allocPoint).div(totalAllocPoint);
            accHsfPerShare = accHsfPerShare.add(hsfReward.div(totalShares));
        }
        return deposit.rewardShare.mul(accHsfPerShare).div(SCALE).sub(
            deposit.rewardDebt
        ).add(deposit.setRewards);
    }

    function _resetRewardAccs(
        DepositInfo storage deposit,
        PoolInfo storage pool,
        uint256 amount,
        uint256 unlockTime
    )
        internal
    {
        deposit.unlockTime = unlockTime;
        uint256 newShares = amount.mul(getTimeMultiple(unlockTime)).div(SCALE);
        deposit.rewardDebt = newShares.mul(pool.accHsfPerShare).div(SCALE);
        pool.totalShares = pool.totalShares.sub(deposit.rewardShare).add(newShares);
        deposit.rewardShare = newShares;
    }

    /* Safe hsf transfer function, just in case if rounding error causes pool
       to not have enough HSFs. */
    function _safeHsfTransfer(address to, uint256 amount) internal {
        uint256 hsfBal = hsf.balanceOf(address(this));
        hsf.transfer(to, Math.min(amount, hsfBal));
    }
}
