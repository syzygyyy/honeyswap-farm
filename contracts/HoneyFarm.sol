// SPDX-License-Identifier: GNU

pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/math/Math.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


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
        IERC20 pool;
    }

    // Info of each pool.
    struct PoolInfo {
        uint256 allocPoint; // How many allocation points assigned to this pool. SUSHIs to distribute per block.
        uint256 lastRewardTimestamp; // Last block number that SUSHIs distribution occurs.
        uint256 accHsfPerShare; // Accumulated HSFs per share, times SCALE.
        uint256 totalShares; // total shares stored in pool
    }

    // What fractional numbers are scaled by
    uint256 public constant SCALE = 1 ether;
    // The HoneySwap Farm token
    IERC20 public immutable hsf;
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
    // the negative slope of the distribution line
    uint256 public immutable distSlope;
    // starting distribution rate / unit time
    uint256 public immutable startDist;
    // maximum time someone can lock their liquidity for
    uint256 public immutable maxTimeLock;
    // time at which coins begin being distributed
    uint256 public immutable startTime;
    // time at which coins finish being distributed
    uint256 public immutable endTime;
    // whether this contract has been disabled
    bool public contractDisabled;

    constructor(
        IERC20 hsf_,
        uint256 totalHsfToDist,
        uint256 startTime_,
        uint256 endTime_,
        uint256 endDistFrac, // scaled by SCALE
        uint256 maxTimeLock_
    ) ERC721("HoneyFarm Deposits v1", "HFD") {
        hsf = hsf_;
        startTime = startTime_;
        endTime = endTime_;
        maxTimeLock = maxTimeLock_;
        hsf_.safeTransferFrom(msg.sender, address(this), totalHsfToDist);

        uint256 totalTime = endTime_.sub(startTime_, "HF: endTime before startTime");
        // ds = (2 * s) / (te * (r + 1))
        uint256 startDist_ = totalHsfToDist.mul(2).mul(SCALE).div(
            totalTime.mul(endDistFrac.add(SCALE))
        );
        // -m = ds * (1 - r) / te
        distSlope = startDist_.mul(SCALE.sub(endDistFrac)).div(
            totalTime.mul(SCALE)
        );
        startDist = startDist_;
    }

    function poolLength() external view returns (uint256) {
        return _pools.length();
    }

    function getPoolByIndex(uint256 index)
        external
        view
        returns(
            uint256 allocPoint,
            uint256 lastRewardTimestamp,
            uint256 accHsfPerShare,
            uint256 totalShares
        )
    {
        PoolInfo storage pool = poolInfo[IERC20(_pools.at(index))];
        allocPoint = pool.allocPoint;
        lastRewardTimestamp = pool.lastRewardTimestamp;
        accHsfPerShare = pool.accHsfPerShare;
        totalShares = pool.totalShares;
    }

    function disableContract(address tokenRecipient) external onlyOwner {
        massUpdatePools();
        uint256 remainingTokens = getDist(block.timestamp, endTime);
        _safeHsfTransfer(tokenRecipient, remainingTokens);
        contractDisabled = true;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    function add(
        uint256 allocPoint,
        IERC20 lpToken,
        bool withUpdate
    ) public onlyOwner {
        if (withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardTimestamp = Math.max(block.timestamp, startTime);
        totalAllocPoint = totalAllocPoint.add(allocPoint);
        require(_pools.add(address(lpToken)), "HF: LP pool already exists");
        poolInfo[lpToken] = PoolInfo({
            allocPoint: allocPoint,
            lastRewardTimestamp: lastRewardTimestamp,
            accHsfPerShare: 0,
            totalShares: 0
        });
    }

    // Update the given pool's SUSHI allocation point. Can only be called by the owner.
    function set(
        IERC20 pool,
        uint256 allocPoint,
        bool withUpdate
    ) public onlyOwner {
        if (withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint.sub(poolInfo[pool].allocPoint).add(
            allocPoint
        );
        poolInfo[pool].allocPoint = allocPoint;
    }

    // get tokens to be distributed between two timestamps
    function getDist(uint256 from, uint256 to)
        public
        view
        returns (uint256)
    {
        from = Math.max(startTime, from);
        to = Math.min(to, endTime);

        if (from > to) return 0;

        /*
           total earned is the distribution formula (m * t + ds) integrated from
           t1 (from) to t2 (to):
           (1/2 * m * t2^2 + ds * t2) - (1/2 * m * t1^2 + ds * t1)
           simplify to (t2 - t1) * (1/2 * m * (t2 + t1) + ds) to reduce
           arithemtic operations */
        return from.sub(to).mul(
            startDist.mul(2).sub(distSlope.mul(from.add(to)))
        ).div(2);
    }

    function getTimeMultiple(uint256) public view returns(uint256) {
        return 1;
    }

    // View function to see pending HSFs on frontend.
    function pendingHsf(IERC20 poolToken, uint256 depositId)
        external
        view
        returns (uint256)
    {
        PoolInfo storage pool = poolInfo[poolToken];
        DepositInfo storage deposit = depositInfo[depositId];
        uint256 accHsfPerShare = pool.accHsfPerShare;
        uint256 totalShares = pool.totalShares;
        if (block.timestamp > pool.lastRewardTimestamp && totalShares != 0) {
            uint256 dist = getDist(pool.lastRewardTimestamp, block.timestamp);
            uint256 hsfReward = dist.mul(pool.allocPoint).div(totalAllocPoint);
            accHsfPerShare = accHsfPerShare.add(
                hsfReward.mul(SCALE).div(totalShares)
            );
        }
        return deposit.rewardShare.mul(accHsfPerShare).div(SCALE).sub(
            deposit.rewardDebt
        );
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
        pool.accHsfPerShare = pool.accHsfPerShare.add(
            hsfReward.mul(SCALE).div(totalShares)
        );
        pool.lastRewardTimestamp = block.timestamp;
    }

    // Deposit LP tokens into the farm to earn HSF
    function createDeposit(
        IERC20 poolToken,
        uint256 amount,
        uint256 unlockTime
    )
        public
    {
        require(
            unlockTime == 0 || unlockTime > block.timestamp,
            "HF: Invalid unlock time"
        );
        require(_pools.contains(address(poolToken)), "HF: Non-existant pool");
        PoolInfo storage pool = poolInfo[poolToken];
        updatePool(poolToken);
        poolToken.safeTransferFrom(
            address(msg.sender),
            address(this),
            amount
        );
        uint256 newDepositId = totalDeposits++;
        uint256 newShares = amount.mul(getTimeMultiple(unlockTime));
        pool.totalShares = pool.totalShares.add(newShares);
        depositInfo[newDepositId] = DepositInfo({
            amount: amount,
            rewardDebt: amount.mul(pool.accHsfPerShare).div(SCALE),
            unlockTime: unlockTime,
            rewardShare: newShares,
            pool: poolToken
        });
        _safeMint(msg.sender, newDepositId);
    }

    // Withdraw LP tokens from MasterChef.
    function closeDeposit(uint256 depositId) public {
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

        uint256 pending =
            deposit.rewardShare.mul(pool.accHsfPerShare).div(SCALE).sub(
                deposit.rewardDebt
            );

        _safeHsfTransfer(msg.sender, pending);
        poolToken.safeTransfer(msg.sender, deposit.amount);
        _burn(depositId);
    }

    /* Safe hsf transfer function, just in case if rounding error causes pool
       to not have enough HSFs. */
    function _safeHsfTransfer(address to, uint256 amount) internal {
        uint256 hsfBal = hsf.balanceOf(address(this));
        hsf.transfer(to, Math.min(amount, hsfBal));
    }
}
