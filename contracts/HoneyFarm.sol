// SPDX-License-Identifier: GNU

pragma solidity 0.7.6;

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
        address pool;
    }

    // Info of each pool.
    struct PoolInfo {
        uint256 allocPoint; // How many allocation points assigned to this pool. SUSHIs to distribute per block.
        uint256 lastRewardTimestamp; // Last block number that SUSHIs distribution occurs.
        uint256 accHsfPerShare; // Accumulated HSFs per share, times SCALE. See below.
        uint256 totalShares;
    }

    // What fractional numbers are scaled by
    uint256 public constant SCALE = 1 ether;
    // The HoneySwap Farm token
    IERC20 public immutable hsf;
    // Info of each pool.
    mapping(IERC20 => PoolInfo) public poolInfo;
    // set of running pools
    EnumerableSet.AddressSet public pools;
    // Total allocation poitns. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint;
    // total deposits
    uint256 public totalDeposits;
    // data about infdividual deposits
    mapping(uint256 => DepositInfo) public depositInfo;
    // negtaive distribution graph slope
    uint256 public immutable distSlope;
    // starting dist amount
    uint256 public immutable startDist;
    // maximum time someone can lock their liquidity for
    uint256 public immutable maxTimeLock;
    // time at which coins begin being distributed
    uint256 public immutable startTime;
    // time at which coins finish being distributed
    uint256 public immutable endTime;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(
        address indexed user,
        uint256 indexed pid,
        uint256 amount
    );

    constructor(
        HSFToken hsf_,
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
        hsf.safeTransferFrom(msg.sender, address(this), totalHsfToDist);

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
        return pools.length();
    }

    function depositLength() external view returns(uint256) {
        return depositInfo.length;
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
        require(pools.add(address(lpToken)), "HF: LP pool already exists");
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

        /*
           total earned is the distribution formula (m * t + ds) integrated from
           t1 to t2:
           (1/2 * m * t2^2 + ds * t2) - (1/2 * m * t1^2 + ds * t1)
           simplify to (t2 - t1) * (1/2 * m * (t2 + t1) + ds) to reduce
           arithemtic operations */
        return from.sub(to).mul(
            startDist.mul(2).sub(distSlope.mul(from.add(to)))
        ).div(2);
    }

    function getRewardShare

    // View function to see pending HSFs on frontend.
    function pendingHsf(IERC20 poolToken, uint256 depositId)
        external
        view
        returns (uint256)
    {
        PoolInfo storage pool = poolInfo[poolToken];
        DepositInfo storage deposit = depositInfo[depositId];
        uint256 accHsfPerShare = pool.accHsfPerShare;
        uint256 lpSupply = poolToken.balanceOf(address(this));
        if (block.timestamp > pool.lastRewardTimestamp && lpSupply != 0) {
            uint256 dist = getDist(pool.lastRewardTimestamp, block.timestamp);
            uint256 hsfReward = dist.mul(pool.allocPoint).div(totalAllocPoint);
            accHsfPerShare = accHsfPerShare.add(
                hsfReward.mul(SCALE).div(lpSupply)
            );
        }
        return deposit.rewardShare.mul(accHsfPerShare).div(SCALE).sub(
            deposit.rewardDebt
        );
    }

    // Update reward vairables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = pools.length();
        for (uint256 pid = 0; pid < length; pid++) {
            updatePool(IERC20(pools.at(pid)));
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(IERC20 poolToken) public {
        PoolInfo storage pool = poolInfo[poolToken];
        if (block.timestamp <= pool.lastRewardTimestamp) {
            return;
        }
        uint256 lpSupply = poolToken.balanceOf(address(this));
        if (lpSupply == 0) {
            pool.lastRewardTimestamp = block.timestamp;
            return;
        }
        uint256 dist = getDist(pool.lastRewardTimestamp, block.timestamp);
        uint256 hsfReward = dist.mul(pool.allocPoint).div(totalAllocPoint);
        pool.accHsfPerShare = pool.accHsfPerShare.add(
            hsfReward.mul(SCALE).div(lpSupply)
        );
        pool.lastRewardTimestamp = block.timestamp;
    }

    // Deposit LP tokens into the farm to earn HSF
    function deposit(
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
        PoolInfo storage pool = poolInfo[poolToken];
        updatePool(poolToken);
        pool.lpToken.safeTransferFrom(
            address(msg.sender),
            address(this),
            amount
        );
        uint256 newDepositId = totalDeposits++;
        _safeMint(msg.sender, newDepositId);
        DepositInfo memory newDeposit = DepositInfo({
            amount: amount,
            rewardDebt: amount.mul().div(SCALE),
            unlockTime: unlockTime,


        });
        emit Deposit(msg.sender, _pid, _amount);
    }

    // Withdraw LP tokens from MasterChef.
    function withdraw(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "withdraw: not good");
        updatePool(_pid);
        uint256 pending =
            user.amount.mul(pool.accSushiPerShare).div(1e12).sub(
                user.rewardDebt
            );
        safeSushiTransfer(msg.sender, pending);
        user.amount = user.amount.sub(_amount);
        user.rewardDebt = user.amount.mul(pool.accSushiPerShare).div(1e12);
        pool.lpToken.safeTransfer(address(msg.sender), _amount);
        emit Withdraw(msg.sender, _pid, _amount);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        pool.lpToken.safeTransfer(address(msg.sender), user.amount);
        emit EmergencyWithdraw(msg.sender, _pid, user.amount);
        user.amount = 0;
        user.rewardDebt = 0;
    }

    /* Safe hsf transfer function, just in case if rounding error causes pool
       to not have enough HSFs.*/
    function _safeHsfTransfer(address to, uint256 amount) internal {
        uint256 hsfBal = hsf.balanceOf(address(this));
        hsf.transfer(to, Math.min(amount, hsfBal));
    }
}
