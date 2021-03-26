const { contract, accounts } = require('@openzeppelin/test-environment')
const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers')
const { MAX_UINT256, ZERO_ADDRESS } = constants
const {
  bnPerc,
  ether,
  getTxNonce,
  getDetAddr,
  ZERO,
  trackBalance,
  expectEqualWithinFraction,
  expectEqualWithinError,
  bnE
} = require('./utils')
const { expect } = require('chai')
const BN = require('bn.js')

const [admin1, user1, user2, attacker1] = accounts

const HoneyFarm = contract.fromArtifact('HoneyFarm')
const HSFToken = contract.fromArtifact('HSFToken')
const ReferralRewarder = contract.fromArtifact('ReferralRewarder')
const TestERC20 = contract.fromArtifact('TestERC20')

describe('HoneyFarm', () => {
  const fundReferralRewarder = async () => {
    await this.farmToken.transfer(
      this.referralRewarder.address,
      bnPerc(await this.farmToken.totalSupply(), '50'),
      { from: admin1 }
    )
  }

  beforeEach(async () => {
    this.farmToken = await HSFToken.new({ from: admin1 })

    this.SCALE = ether('1')
    this.totalTime = time.duration.years(1)
    this.startDelta = time.duration.weeks(1)
    this.totalDist = bnPerc(await this.farmToken.totalSupply(), '50')
    this.endDistFrac = '20'
    const currentTime = await time.latest()
    this.startTime = currentTime.add(this.startDelta)
    this.endTime = this.startTime.add(this.totalTime)

    const nonce = await getTxNonce(this.farmToken.transactionHash)
    const farmAddr = getDetAddr(admin1, nonce + 2)
    await this.farmToken.approve(farmAddr, this.totalDist, { from: admin1 })

    this.farm = await HoneyFarm.new(
      this.farmToken.address,
      this.totalDist,
      this.startTime,
      this.endTime,
      bnPerc(this.SCALE, this.endDistFrac),
      this.totalTime,
      bnPerc(this.SCALE, '2').div(time.duration.weeks(4)),
      this.SCALE,
      { from: admin1 }
    )
    this.errorTime = time.duration.seconds(5)
    this.maxError = (
      await this.farm.getDist(this.startTime, this.startTime.add(this.errorTime))
    ).div(this.SCALE)

    expect(await this.farmToken.balanceOf(this.farm.address)).to.be.bignumber.equal(this.totalDist)
    this.refRewardRate = ether('0.8')
    this.referralRewarder = await ReferralRewarder.new(this.farmToken.address, this.refRewardRate, {
      from: admin1
    })
    await this.referralRewarder.transferOwnership(this.farm.address, { from: admin1 })
    await this.farm.setReferralRewarder(this.referralRewarder.address, { from: admin1 })

    this.SCALE = await this.farm.SCALE()

    this.lpToken1 = await TestERC20.new()
    this.lpToken2 = await TestERC20.new()
  })
  describe('general', () => {
    beforeEach(async () => {
      await fundReferralRewarder()
    })
    it('calculates total distribution accurately', async () => {
      const dist = await this.farm.getDist(this.startTime, this.endTime)
      expect(dist.div(this.SCALE)).to.be.bignumber.equal(this.totalDist)
    })
    it('can add pool', async () => {
      expect(await this.farm.poolLength()).to.be.bignumber.equal(ZERO)
      const allocPoints = new BN('20')
      await this.farm.add(allocPoints, this.lpToken1.address, {
        from: admin1
      })

      expect(await this.farm.totalAllocPoint()).to.be.bignumber.equal(allocPoints)
      expect(await this.farm.poolLength()).to.be.bignumber.equal(new BN('1'))

      const pool = await this.farm.poolInfo(this.lpToken1.address)
      expect(pool.allocPoint).to.be.bignumber.equal(allocPoints)
      expect(pool.accHsfPerShare).to.be.bignumber.equal(ZERO)
      expect(pool.totalShares).to.be.bignumber.equal(ZERO)
      expect(pool.lastRewardTimestamp).to.be.bignumber.equal(await this.farm.startTime())
    })
    it('updates pool correctly when entering and exiting', async () => {
      await expectRevert(
        this.farm.getPoolByIndex(new BN('0')),
        'EnumerableSet: index out of bounds'
      )
      console.log('1')
      // correct empty defaults
      const beforeAddPoolInfo = await this.farm.poolInfo(this.lpToken1.address)
      expect(beforeAddPoolInfo.allocPoint).to.be.bignumber.equal(ZERO)
      expect(beforeAddPoolInfo.lastRewardTimestamp).to.be.bignumber.equal(ZERO)
      expect(beforeAddPoolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO)
      expect(beforeAddPoolInfo.totalShares).to.be.bignumber.equal(ZERO)

      // correctly adds pools
      let allocPoint = new BN('20')
      const poolToken = this.lpToken1.address
      let receipt = await this.farm.add(allocPoint, poolToken, {
        from: admin1
      })
      expectEvent(receipt, 'PoolAdded', { poolToken, allocPoint })
      expectEvent.notEmitted(receipt, 'PoolUpdated')
      await expectRevert(
        this.farm.add(new BN('30'), poolToken, { from: admin1 }),
        'HF: LP pool already exists'
      )

      console.log('2')
      // correct initialized defaults
      const startTime = await this.farm.startTime()
      let poolInfo = await this.farm.poolInfo(poolToken)
      expect(poolInfo.allocPoint).to.be.bignumber.equal(allocPoint)
      expect(poolInfo.lastRewardTimestamp).to.be.bignumber.equal(startTime)
      expect(poolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO)
      expect(poolInfo.totalShares).to.be.bignumber.equal(ZERO)

      // open deposit
      await this.lpToken1.mint(user1, ether('60'))
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 })
      const deposit1 = ether('30')
      await this.farm.createDeposit(this.lpToken1.address, deposit1, ZERO, ZERO_ADDRESS, {
        from: user1
      })

      console.log('3')
      // correctly updates after deposit added
      poolInfo = await this.farm.poolInfo(poolToken)
      expect(poolInfo.allocPoint).to.be.bignumber.equal(allocPoint)
      expect(poolInfo.lastRewardTimestamp).to.be.bignumber.equal(startTime)
      expect(poolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO)
      expect(poolInfo.totalShares).to.be.bignumber.equal(deposit1)

      // open second deposit
      const deposit2 = ether('20')
      await this.farm.createDeposit(poolToken, deposit2, ZERO, ZERO_ADDRESS, { from: user1 })

      console.log('4')
      // correctly updates after another deposit is added
      poolInfo = await this.farm.poolInfo(poolToken)
      expect(poolInfo.allocPoint).to.be.bignumber.equal(allocPoint)
      expect(poolInfo.lastRewardTimestamp).to.be.bignumber.equal(startTime)
      expect(poolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO)
      expect(poolInfo.totalShares).to.be.bignumber.equal(deposit1.add(deposit2))

      // allow rewards to accrue and update pools
      const skipTo = startTime.add(time.duration.days(2))
      await time.increaseTo(skipTo)
      const expectedRewardPerShare = (await this.farm.getDist(startTime, skipTo)).div(
        deposit1.add(deposit2)
      )
      await this.farm.updatePool(poolToken)

      console.log('5')
      // correctly updates after rewards accrue
      poolInfo = await this.farm.poolInfo(poolToken)
      expect(poolInfo.allocPoint).to.be.bignumber.equal(allocPoint)
      expectEqualWithinError(poolInfo.lastRewardTimestamp, skipTo, time.duration.seconds(2))
      expectEqualWithinFraction(
        poolInfo.accHsfPerShare,
        expectedRewardPerShare,
        new BN('1'),
        bnE('1', '6'),
        'Incorrect rewards per share'
      )
      expect(poolInfo.totalShares).to.be.bignumber.equal(deposit1.add(deposit2))

      // change pool weight
      allocPoint = new BN('10')
      receipt = await this.farm.set(poolToken, allocPoint, { from: admin1 })
      expectEvent(receipt, 'PoolUpdated', { poolToken, allocPoint })
      expectEvent.notEmitted(receipt, 'PoolAdded')

      console.log('6')
      poolInfo = await this.farm.poolInfo(poolToken)
      expect(poolInfo.allocPoint).to.be.bignumber.equal(allocPoint)
      expectEqualWithinError(poolInfo.lastRewardTimestamp, skipTo, time.duration.seconds(2))
      expectEqualWithinError(poolInfo.accHsfPerShare, expectedRewardPerShare, this.maxError)
      expect(poolInfo.totalShares).to.be.bignumber.equal(deposit1.add(deposit2))

      // closing a deposit
      await this.farm.closeDeposit(new BN('0'), { from: user1 })

      console.log('7')
      poolInfo = await this.farm.poolInfo(poolToken)
      expect(poolInfo.allocPoint).to.be.bignumber.equal(allocPoint)
      expectEqualWithinError(poolInfo.lastRewardTimestamp, skipTo, time.duration.seconds(2))
      expectEqualWithinFraction(
        poolInfo.accHsfPerShare,
        expectedRewardPerShare,
        new BN('1'),
        bnE('1', '6')
      )
      expect(poolInfo.totalShares).to.be.bignumber.equal(deposit2)
    })
    it('can deposit LP tokens', async () => {
      expect(await this.farm.totalDeposits()).to.be.bignumber.equal(ZERO)

      // test setup
      await this.farm.add(new BN('20'), this.lpToken1.address, {
        from: admin1
      })
      await this.lpToken1.mint(user1, ether('54'))
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 })
      const user1lp1 = await trackBalance(this.lpToken1, user1)
      const farmlp1 = await trackBalance(this.lpToken1, this.farm.address)

      // creating deposit
      const depositAmount1 = ether('21')
      let receipt = await this.farm.createDeposit(
        this.lpToken1.address,
        depositAmount1,
        ZERO,
        ZERO_ADDRESS,
        { from: user1 }
      )

      // general params
      expect(await user1lp1.delta()).to.be.bignumber.equal(depositAmount1.neg())
      expect(await farmlp1.delta()).to.be.bignumber.equal(depositAmount1)
      expect(await this.farm.totalDeposits()).to.be.bignumber.equal(new BN('1'))
      expect((await this.farm.poolInfo(this.lpToken1.address)).totalShares).to.be.bignumber.equal(
        depositAmount1
      )

      // deposit params
      expectEvent(receipt, 'Transfer', { from: ZERO_ADDRESS, to: user1, tokenId: new BN('0') })
      const depositInfo1 = await this.farm.depositInfo(new BN('0'))
      expect(depositInfo1.amount).to.be.bignumber.equal(depositAmount1)
      expect(depositInfo1.rewardShare).to.be.bignumber.equal(depositAmount1)
      expect(depositInfo1.pool).to.equal(this.lpToken1.address)
      expect(depositInfo1.rewardDebt).to.be.bignumber.equal(ZERO)
      expect(depositInfo1.unlockTime).to.be.bignumber.equal(ZERO)

      // creating deposit
      const depositAmount2 = ether('11')
      receipt = await this.farm.createDeposit(
        this.lpToken1.address,
        depositAmount2,
        ZERO,
        ZERO_ADDRESS,
        { from: user1 }
      )

      // general params
      expect(await user1lp1.delta()).to.be.bignumber.equal(depositAmount2.neg())
      expect(await farmlp1.delta()).to.be.bignumber.equal(depositAmount2)
      expect(await this.farm.totalDeposits()).to.be.bignumber.equal(new BN('2'))
      expect((await this.farm.poolInfo(this.lpToken1.address)).totalShares).to.be.bignumber.equal(
        depositAmount1.add(depositAmount2)
      )

      // deposit params
      expectEvent(receipt, 'Transfer', { from: ZERO_ADDRESS, to: user1, tokenId: new BN('1') })
      const depositInfo2 = await this.farm.depositInfo(new BN('1'))
      expect(depositInfo2.amount).to.be.bignumber.equal(depositAmount2)
      expect(depositInfo2.rewardShare).to.be.bignumber.equal(depositAmount2)
      expect(depositInfo2.pool).to.equal(this.lpToken1.address)
      expect(depositInfo2.rewardDebt).to.be.bignumber.equal(ZERO)
      expect(depositInfo2.unlockTime).to.be.bignumber.equal(ZERO)

      expect(await this.farm.pendingHsf(new BN('0'))).to.be.bignumber.equal(ZERO)
      expect(await this.farm.pendingHsf(new BN('1'))).to.be.bignumber.equal(ZERO)
    })
    it('can create, transfer and close deposit', async () => {
      await this.farm.add(new BN('20'), this.lpToken1.address, {
        from: admin1
      })
      await this.lpToken1.mint(user1, ether('54'))
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 })

      const user2hsfTracker = await trackBalance(this.farmToken, user2)
      const user2lpTracker = await trackBalance(this.lpToken1, user2)

      const depositAmount = ether('34')
      await this.farm.createDeposit(this.lpToken1.address, depositAmount, ZERO, ZERO_ADDRESS, {
        from: user1
      })
      const expectedDepositId = new BN('0')
      expect(await this.farm.ownerOf(expectedDepositId)).to.equal(user1)

      await time.increaseTo((await this.farm.startTime()).sub(time.duration.minutes(1)))

      let pendingHsf = await this.farm.pendingHsf(expectedDepositId)
      expect(pendingHsf).to.be.bignumber.equal(ZERO, 'Initial pending HSF should be 0')

      await time.increaseTo(await this.farm.endTime())
      pendingHsf = await this.farm.pendingHsf(expectedDepositId)
      expectEqualWithinFraction(pendingHsf, this.totalDist, new BN('1'), ether('1'))

      let receipt = await this.farm.safeTransferFrom(user1, user2, expectedDepositId, {
        from: user1
      })
      expectEvent(receipt, 'Transfer', { from: user1, to: user2, tokenId: expectedDepositId })

      await expectRevert(
        this.farm.closeDeposit(expectedDepositId, { from: user1 }),
        'HF: Must be owner to withdraw'
      )

      receipt = await this.farm.closeDeposit(expectedDepositId, { from: user2 })
      expectEvent(receipt, 'Transfer', {
        from: user2,
        to: ZERO_ADDRESS,
        tokenId: expectedDepositId
      })
      expect(await user2hsfTracker.delta()).to.be.bignumber.equal(
        pendingHsf,
        'Withdrawer is expected to be accredited the pending rewards'
      )
      expect(await user2lpTracker.delta()).to.be.bignumber.equal(
        depositAmount,
        'Withdrawer is expected to retrieve his LP tokens'
      )
      await expectRevert(
        this.farm.ownerOf(expectedDepositId),
        'ERC721: owner query for nonexistent token'
      )
    })
    it('distributes proportional to deposit size', async () => {
      await this.farm.add(new BN('20'), this.lpToken1.address, {
        from: admin1
      })

      const mintAmount1 = ether('10')
      await this.lpToken1.mint(user1, mintAmount1)
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 })
      const user1Tracker = await trackBalance(this.farmToken, user1)

      const mintAmount2 = mintAmount1.mul(new BN('2'))
      await this.lpToken1.mint(user2, mintAmount2)
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user2 })
      const user2Tracker = await trackBalance(this.farmToken, user2)

      let receipt = await this.farm.createDeposit(
        this.lpToken1.address,
        mintAmount1,
        ZERO,
        ZERO_ADDRESS,
        {
          from: user1
        }
      )
      expectEvent(receipt, 'Transfer', { from: ZERO_ADDRESS, to: user1, tokenId: new BN('0') })

      receipt = await this.farm.createDeposit(
        this.lpToken1.address,
        mintAmount2,
        ZERO,
        ZERO_ADDRESS,
        {
          from: user2
        }
      )
      expectEvent(receipt, 'Transfer', { from: ZERO_ADDRESS, to: user2, tokenId: new BN('1') })

      await time.increaseTo(await this.farm.endTime())

      await this.farm.closeDeposit(new BN('0'), { from: user1 })
      await this.farm.closeDeposit(new BN('1'), { from: user2 })

      expect((await user1Tracker.delta()).mul(new BN('2'))).to.be.bignumber.equal(
        await user2Tracker.delta(),
        'rewards mismatch'
      )

      const totalRewards = (await user1Tracker.get()).add(await user2Tracker.get())
      expectEqualWithinFraction(
        totalRewards,
        this.totalDist,
        new BN('1'),
        ether('1'),
        'total rewards mismatch'
      )
    })
    it('keeps track of duration in pool for deposits', async () => {
      await this.farm.add(new BN('20'), this.lpToken1.address, {
        from: admin1
      })

      const mintAmount1 = ether('10')
      await this.lpToken1.mint(user1, mintAmount1)
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 })
      const user1Tracker = await trackBalance(this.farmToken, user1)

      const mintAmount2 = mintAmount1.mul(new BN('2'))
      await this.lpToken1.mint(user2, mintAmount2)
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user2 })
      const user2Tracker = await trackBalance(this.farmToken, user2)

      const totalMinted = mintAmount1.add(mintAmount2)

      await this.farm.createDeposit(this.lpToken1.address, mintAmount1, ZERO, ZERO_ADDRESS, {
        from: user1
      })

      const third = this.totalTime.div(new BN('3'))
      const startTime = await this.farm.startTime()

      await time.increaseTo(startTime.add(third))
      await this.farm.createDeposit(this.lpToken1.address, mintAmount2, ZERO, ZERO_ADDRESS, {
        from: user2
      })

      const depositInfo2 = await this.farm.depositInfo(new BN('1'))
      expect(depositInfo2.amount).to.be.bignumber.equal(mintAmount2)
      expect(depositInfo2.rewardShare).to.be.bignumber.equal(mintAmount2)
      const firstThirdDist = await this.farm.getDist(startTime, startTime.add(third))
      const convDebt = depositInfo2.rewardDebt.mul(mintAmount1).div(mintAmount2)
      expectEqualWithinFraction(
        convDebt,
        firstThirdDist.div(this.SCALE),
        new BN('1'),
        bnE('1', '6'),
        'Reward debt doesn\'t displace accrued total rewards'
      )

      const twoThirdsTime = startTime.add(third).add(third)
      await time.increaseTo(twoThirdsTime)
      await this.farm.closeDeposit(new BN('1'), { from: user2 })

      const middleThirdDist = await this.farm.getDist(startTime.add(third), twoThirdsTime)
      const user2Share = middleThirdDist.mul(mintAmount2).div(totalMinted)
      expectEqualWithinFraction(
        await user2Tracker.delta(),
        user2Share.div(this.SCALE),
        new BN('1'),
        bnE('1', '6'),
        'User withdrawing inbetween didn\'t receive expected reward'
      )

      const endTime = await this.farm.endTime()
      await time.increaseTo(endTime)
      await this.farm.closeDeposit(new BN('0'), { from: user1 })
      const lastThirdDist = await this.farm.getDist(twoThirdsTime, endTime)
      const user1MiddleShare = middleThirdDist.mul(mintAmount1).div(totalMinted)
      expectEqualWithinFraction(
        await user1Tracker.delta(),
        firstThirdDist.add(user1MiddleShare).add(lastThirdDist).div(this.SCALE),
        new BN('1'),
        bnE('1', '6'),
        'Last user didn\'t receive remaining rewards'
      )
    })
  })
  describe('deposit creation and management', () => {
    beforeEach(async () => {
      this.poolToken = this.lpToken1.address
      await this.farm.add(new BN('20'), this.poolToken, { from: admin1 })
      this.mintAmount = ether('10')
      await this.lpToken1.mint(user1, this.mintAmount)
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 })
    })
    it('correctly initializes time-locked deposit before reward distribution begin', async () => {
      // setup
      const user1Tracker = await trackBalance(this.lpToken1, user1)

      // creating deposit
      const depositDuration = time.duration.days(60)
      const depositEnd = (await time.latest()).add(depositDuration)
      const expectedDepositId = new BN('0')
      const expectedMultiplier = await this.farm.getTimeMultiple(depositEnd)
      const expectedShares = this.mintAmount.mul(expectedMultiplier).div(this.SCALE)
      let receipt = await this.farm.createDeposit(
        this.poolToken,
        this.mintAmount,
        depositEnd,
        ZERO_ADDRESS,
        { from: user1 }
      )

      // verify creation
      expectEvent(receipt, 'Transfer', {
        from: ZERO_ADDRESS,
        to: user1,
        tokenId: expectedDepositId
      })
      expect(await user1Tracker.delta()).to.be.bignumber.equal(
        this.mintAmount.neg(),
        'no tokens deducted'
      )

      // verify new deposit params
      const depositInfo = await this.farm.depositInfo(expectedDepositId)
      expect(depositInfo.amount).to.be.bignumber.equal(this.mintAmount, 'deposit amount no stored')
      expect(depositInfo.rewardDebt).to.be.bignumber.equal(ZERO)
      expect(depositInfo.unlockTime).to.be.bignumber.equal(depositEnd)
      expectEqualWithinFraction(depositInfo.rewardShare, expectedShares, new BN('1'), bnE('1', '6'))
      expect(depositInfo.setRewards).to.be.bignumber.equal(ZERO)
      expect(depositInfo.pool).to.equal(this.poolToken)
      expect(depositInfo.referrer).to.equal(ZERO_ADDRESS)
    })
    it('allows downgrading deposit who\'s time-lock has expired', async () => {
      const user1PoolTracker = await trackBalance(this.lpToken1, user1)
      const user1xCombTracker = await trackBalance(this.farmToken, user1)

      const depositDuration = time.duration.days(60)
      const depositEnd = (await time.latest()).add(depositDuration)
      const depositId = new BN('0')
      await this.farm.createDeposit(this.poolToken, this.mintAmount, depositEnd, ZERO_ADDRESS, {
        from: user1
      })
      await user1xCombTracker.reset()
      await user1PoolTracker.reset()

      // too early downgrade
      await expectRevert(
        this.farm.downgradeExpired(depositId, { from: attacker1 }),
        'HF: deposit has not expired yet'
      )

      // correct downgrade
      await time.increaseTo(depositEnd)
      let receipt = await this.farm.downgradeExpired(depositId, { from: user2 })

      expectEvent(receipt, 'DepositDowngraded', {
        downgrader: user2,
        depositId
      })

      const poolInfo = await this.farm.poolInfo(this.poolToken)
      expect(poolInfo.totalShares).to.be.bignumber.equal(this.mintAmount)

      const expectedDebt = poolInfo.accHsfPerShare.mul(this.mintAmount).div(this.SCALE)
      const expectedRewards = await this.farm.getDist(this.startTime, poolInfo.lastRewardTimestamp)

      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(ZERO)
      expect(await user1xCombTracker.delta()).to.be.bignumber.equal(ZERO)
      const depositInfo = await this.farm.depositInfo(depositId)
      expect(depositInfo.amount).to.be.bignumber.equal(this.mintAmount, 'wrong amount')
      expect(depositInfo.rewardDebt).to.be.bignumber.equal(expectedDebt, 'wrong reward debt')
      expect(depositInfo.unlockTime).to.be.bignumber.equal(ZERO)
      expect(depositInfo.rewardShare).to.be.bignumber.equal(this.mintAmount, 'wrong share')
      expectEqualWithinFraction(
        depositInfo.setRewards,
        expectedRewards.div(this.SCALE),
        new BN('1'),
        bnE('1', '6'),
        'wrong set rewards'
      )
      expect(depositInfo.pool).to.be.bignumber.equal(this.poolToken)
      expect(depositInfo.referrer).to.be.bignumber.equal(ZERO_ADDRESS)

      // skip a little forward
      const forwardSkip = time.duration.days(2)
      const targetTime = depositEnd.add(forwardSkip)
      await time.increaseTo(targetTime)

      await expectRevert(
        this.farm.downgradeExpired(depositId, { from: attacker1 }),
        'HF: no lock to expire'
      )
      receipt = await this.farm.closeDeposit(depositId, { from: user1 })

      // check successful closing
      expectEvent(receipt, 'Transfer', { from: user1, to: ZERO_ADDRESS, tokenId: depositId })
      await expectRevert(this.farm.ownerOf(depositId), 'ERC721: owner query for nonexistent token')
      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(this.mintAmount)
      expectEqualWithinError(
        await user1xCombTracker.delta(),
        (await this.farm.getDist(this.startTime, targetTime)).div(this.SCALE),
        this.maxError
      )
    })
    it('allows withdrawing pending rewards from locked deposit', async () => {
      const user1PoolTracker = await trackBalance(this.lpToken1, user1)
      const user1xCombTracker = await trackBalance(this.farmToken, user1)

      const depositDuration = time.duration.days(60)
      const depositEnd = (await time.latest()).add(depositDuration)
      const midPoint = depositEnd.sub(depositDuration.div(new BN('2')))
      const depositId = new BN('0')
      await this.farm.createDeposit(this.poolToken, this.mintAmount, depositEnd, ZERO_ADDRESS, {
        from: user1
      })
      await user1xCombTracker.reset()
      await user1PoolTracker.reset()

      // jump to half way point
      await time.increaseTo(midPoint)

      await expectRevert(
        this.farm.withdrawRewards(depositId, { from: attacker1 }),
        'HF: Must be owner of deposit'
      )

      let pendingRewards = await this.farm.pendingHsf(depositId)
      let receipt = await this.farm.withdrawRewards(depositId, { from: user1 })
      expectEqualWithinFraction(
        await user1xCombTracker.delta(),
        pendingRewards,
        new BN('1'),
        bnE('1', '6'),
        'didn\'t receive pending rewards'
      )
      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(ZERO)
      expectEvent.notEmitted(receipt, 'DepositDowngraded')
      pendingRewards = await this.farm.pendingHsf(depositId)
      expectEqualWithinError(
        pendingRewards,
        ZERO,
        this.maxError,
        'rewards still pending after withdraw'
      )

      // jump to end
      await time.increaseTo(depositEnd)
      pendingRewards = await this.farm.pendingHsf(depositId)
      receipt = await this.farm.withdrawRewards(depositId, { from: user1 })
      expectEqualWithinFraction(
        await user1xCombTracker.delta(),
        pendingRewards,
        new BN('1'),
        bnE('1', '6')
      )
      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(ZERO)
      expect(receipt, 'DepositDowngraded', { downgrader: user1, depositId })
      pendingRewards = await this.farm.pendingHsf(depositId)
      expectEqualWithinError(pendingRewards, ZERO, this.maxError)

      expectEqualWithinFraction(
        await user1xCombTracker.get(),
        (await this.farm.getDist(this.startTime, depositEnd)).div(this.SCALE),
        new BN('1'),
        bnE('1', '6')
      )

      // still acrues withdrawable rewards after downgrade
      await time.increase(time.duration.days(20))
      pendingRewards = await this.farm.pendingHsf(depositId)
      receipt = await this.farm.withdrawRewards(depositId, { from: user1 })
      expectEqualWithinFraction(
        await user1xCombTracker.delta(),
        pendingRewards,
        new BN('1'),
        bnE('1', '6')
      )
      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(ZERO)
      expectEvent.notEmitted(receipt, 'DepositDowngraded')
      pendingRewards = await this.farm.pendingHsf(depositId)
      expectEqualWithinError(pendingRewards, ZERO, this.maxError)

      pendingRewards = await this.farm.pendingHsf(depositId)
      receipt = await this.farm.closeDeposit(depositId, { from: user1 })
      expectEqualWithinFraction(
        await user1xCombTracker.delta(),
        pendingRewards,
        new BN('1'),
        bnE('1', '6')
      )
      expect(await user1PoolTracker.delta()).to.be.bignumber.equal(this.mintAmount)
      expectEvent(receipt, 'Transfer', { from: user1, to: ZERO_ADDRESS, tokenId: depositId })

      await expectRevert(
        this.farm.withdrawRewards(depositId, { from: user1 }),
        'ERC721: owner query for nonexistent token'
      )
    })
  })
  describe('referral rewards', () => {
    beforeEach(async () => {
      this.poolToken = this.lpToken1.address
      await this.farm.add(new BN('20'), this.poolToken, { from: admin1 })
      this.mintAmount = ether('10')
      await this.lpToken1.mint(user1, this.mintAmount)
      await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 })
    })
    it('allows no referral', async () => {
      const receipt = await this.farm.createDeposit(
        this.poolToken,
        this.mintAmount,
        ZERO,
        ZERO_ADDRESS,
        { from: user1 }
      )
      expectEvent.notEmitted(receipt, 'Referred')
    })
    it('credits referrer with reward upon closing deposit', async () => {
      await fundReferralRewarder()

      const referrer = user2
      const user1Tracker = await trackBalance(this.farmToken, user1)
      const referrerTracker = await trackBalance(this.farmToken, referrer)

      let receipt = await this.farm.createDeposit(this.poolToken, this.mintAmount, ZERO, referrer, {
        from: user1
      })
      const depositId = new BN('0')
      expectEvent(receipt, 'Referred', { referrer, depositId })

      const timeSkip = time.duration.days(2)
      await time.increaseTo(this.startTime.add(timeSkip))

      receipt = await this.farm.closeDeposit(depositId, { from: user1 })
      const userReward = await user1Tracker.delta()
      const expectedRefReward = userReward.mul(this.refRewardRate).div(this.SCALE)
      expect(await referrerTracker.delta()).to.be.bignumber.equal(expectedRefReward)
    })
    it('doesn\'t revert if referrer runs out of rewards', async () => {
      const timeSkip = time.duration.days(2)

      // fill reward referrer only with half of the required rewards
      const estRewards = (await this.farm.getDist(this.startTime, this.startTime.add(timeSkip)))
        .mul(this.refRewardRate)
        .div(this.SCALE)
        .div(this.SCALE)
      const refReserves = bnPerc(estRewards, '50')
      await this.farmToken.transfer(this.referralRewarder.address, refReserves, {
        from: admin1
      })

      const referrer = user2
      const user1Tracker = await trackBalance(this.farmToken, user1)
      const referrerTracker = await trackBalance(this.farmToken, referrer)

      await this.farm.createDeposit(this.poolToken, this.mintAmount, ZERO, referrer, {
        from: user1
      })
      const depositId = new BN('0')

      await time.increaseTo(this.startTime.add(timeSkip))

      const receipt = await this.farm.closeDeposit(depositId, { from: user1 })
      const userReward = await user1Tracker.delta()
      const expectedTotalReward = userReward.mul(this.refRewardRate).div(this.SCALE)
      const refReward = await referrerTracker.delta()
      expect(refReward).to.be.bignumber.equal(refReserves)
      expectEvent.inTransaction(receipt.tx, this.referralRewarder, 'MissingReward', {
        referrer,
        owedReward: expectedTotalReward.sub(refReward)
      })
    })
  })
})
