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
  bnE
} = require('./utils')
const { expect } = require('chai')
const BN = require('bn.js')

const [admin1, user1, user2] = accounts

const HoneyFarm = contract.fromArtifact('HoneyFarm')
const HSFToken = contract.fromArtifact('HSFToken')
const TestERC20 = contract.fromArtifact('TestERC20')

describe('HoneyFarm', () => {
  beforeEach(async () => {
    this.farmToken = await HSFToken.new({ from: admin1 })

    this.SCALE = ether('1')
    this.totalTime = time.duration.years(1)
    this.startDelta = time.duration.weeks(1)
    this.totalDist = bnPerc(await this.farmToken.totalSupply(), '50')
    this.endDistFrac = '20'
    const currentTime = await time.latest()

    const nonce = await getTxNonce(this.farmToken.transactionHash)
    const farmAddr = getDetAddr(admin1, nonce + 2)
    await this.farmToken.approve(farmAddr, this.totalDist, { from: admin1 })

    this.farm = await HoneyFarm.new(
      this.farmToken.address,
      this.totalDist,
      currentTime.add(this.startDelta),
      currentTime.add(this.startDelta).add(this.totalTime),
      bnPerc(this.SCALE, this.endDistFrac),
      this.totalTime,
      bnPerc(this.SCALE, '2').div(time.duration.weeks(4)),
      this.SCALE,
      { from: admin1 }
    )
    expect(await this.farmToken.balanceOf(this.farm.address)).to.be.bignumber.equal(this.totalDist)
    this.SCALE = await this.farm.SCALE()

    this.lpToken1 = await TestERC20.new()
    this.lpToken2 = await TestERC20.new()
  })
  it('calculates total distribution accurately', async () => {
    const startTime = await this.farm.startTime()
    const endTime = await this.farm.endTime()
    const dist = await this.farm.getDist(startTime, endTime)
    expect(dist.div(this.SCALE)).to.be.bignumber.equal(this.totalDist)
  })
  it('can add pool', async () => {
    expect(await this.farm.poolLength()).to.be.bignumber.equal(ZERO)
    const allocPoints = new BN('20')
    await this.farm.add(allocPoints, this.lpToken1.address, true, {
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
    await expectRevert(this.farm.getPoolByIndex(new BN('0')), 'EnumerableSet: index out of bounds')
    const beforeAddPoolInfo = await this.farm.poolInfo(this.lpToken1.address)
    expect(beforeAddPoolInfo.allocPoint).to.be.bignumber.equal(ZERO)
    expect(beforeAddPoolInfo.lastRewardTimestamp).to.be.bignumber.equal(ZERO)
    expect(beforeAddPoolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO)
    expect(beforeAddPoolInfo.totalShares).to.be.bignumber.equal(ZERO)

    const allocPoint = new BN('20')
    const poolToken = this.lpToken1.address
    const receipt = await this.farm.add(allocPoint, poolToken, true, {
      from: admin1
    })
    expectEvent(receipt, 'PoolAdded', { poolToken, allocPoint })
    await expectRevert(
      this.farm.add(new BN('30'), this.lpToken1.address, true, { from: admin1 }),
      'HF: LP pool already exists'
    )

    const startTime = await this.farm.startTime()
    let poolInfo = await this.farm.poolInfo(this.lpToken1.address)
    expect(poolInfo.allocPoint).to.be.bignumber.equal(allocPoint)
    expect(poolInfo.lastRewardTimestamp).to.be.bignumber.equal(startTime)
    expect(poolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO)
    expect(poolInfo.totalShares).to.be.bignumber.equal(ZERO)

    await this.lpToken1.mint(user1, ether('60'))
    await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 })
    const deposit1 = ether('30')
    await this.farm.createDeposit(this.lpToken1.address, deposit1, ZERO, ZERO_ADDRESS, {
      from: user1
    })

    poolInfo = await this.farm.poolInfo(this.lpToken1.address)
    expect(poolInfo.allocPoint).to.be.bignumber.equal(allocPoint)
    expect(poolInfo.lastRewardTimestamp).to.be.bignumber.equal(startTime)
    expect(poolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO)
    expect(poolInfo.totalShares).to.be.bignumber.equal(deposit1)

    const deposit2 = ether('20')
    await this.farm.createDeposit(this.lpToken1.address, deposit2, ZERO, ZERO_ADDRESS, {
      from: user1
    })

    poolInfo = await this.farm.poolInfo(this.lpToken1.address)
    expect(poolInfo.allocPoint).to.be.bignumber.equal(allocPoint)
    expect(poolInfo.lastRewardTimestamp).to.be.bignumber.equal(startTime)
    expect(poolInfo.accHsfPerShare).to.be.bignumber.equal(ZERO)
    expect(poolInfo.totalShares).to.be.bignumber.equal(deposit1.add(deposit2))

    const skipTo = startTime.add(time.duration.days(2))
    await time.increaseTo(skipTo)
    const expectedRewardPerShare = (await this.farm.getDist(startTime, skipTo)).div(
      deposit1.add(deposit2)
    )
  })
  it('can deposit LP tokens', async () => {
    expect(await this.farm.totalDeposits()).to.be.bignumber.equal(ZERO)

    await this.farm.add(new BN('20'), this.lpToken1.address, true, {
      from: admin1
    })

    await this.lpToken1.mint(user1, ether('54'))
    await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 })
    const user1lp1 = await trackBalance(this.lpToken1, user1)
    const farmlp1 = await trackBalance(this.lpToken1, this.farm.address)

    const depositAmount1 = ether('21')
    let receipt = await this.farm.createDeposit(
      this.lpToken1.address,
      depositAmount1,
      ZERO,
      ZERO_ADDRESS,
      { from: user1 }
    )
    expect(await user1lp1.delta()).to.be.bignumber.equal(depositAmount1.neg())
    expect(await farmlp1.delta()).to.be.bignumber.equal(depositAmount1)
    expect(await this.farm.totalDeposits()).to.be.bignumber.equal(new BN('1'))
    expect((await this.farm.poolInfo(this.lpToken1.address)).totalShares).to.be.bignumber.equal(
      depositAmount1
    )

    expectEvent(receipt, 'Transfer', { from: ZERO_ADDRESS, to: user1, tokenId: new BN('0') })
    const depositInfo1 = await this.farm.depositInfo(new BN('0'))
    expect(depositInfo1.amount).to.be.bignumber.equal(depositAmount1)
    expect(depositInfo1.rewardShare).to.be.bignumber.equal(depositAmount1)
    expect(depositInfo1.pool).to.equal(this.lpToken1.address)
    expect(depositInfo1.rewardDebt).to.be.bignumber.equal(ZERO)
    expect(depositInfo1.unlockTime).to.be.bignumber.equal(ZERO)

    const depositAmount2 = ether('11')
    receipt = await this.farm.createDeposit(
      this.lpToken1.address,
      depositAmount2,
      ZERO,
      ZERO_ADDRESS,
      { from: user1 }
    )
    expect(await user1lp1.delta()).to.be.bignumber.equal(depositAmount2.neg())
    expect(await farmlp1.delta()).to.be.bignumber.equal(depositAmount2)
    expect(await this.farm.totalDeposits()).to.be.bignumber.equal(new BN('2'))
    expect((await this.farm.poolInfo(this.lpToken1.address)).totalShares).to.be.bignumber.equal(
      depositAmount1.add(depositAmount2)
    )

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
    await this.farm.add(new BN('20'), this.lpToken1.address, true, {
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

    let receipt = await this.farm.safeTransferFrom(user1, user2, expectedDepositId, { from: user1 })
    expectEvent(receipt, 'Transfer', { from: user1, to: user2, tokenId: expectedDepositId })

    await expectRevert(
      this.farm.closeDeposit(expectedDepositId, { from: user1 }),
      'HF: Must be owner to withdraw'
    )

    receipt = await this.farm.closeDeposit(expectedDepositId, { from: user2 })
    expectEvent(receipt, 'Transfer', { from: user2, to: ZERO_ADDRESS, tokenId: expectedDepositId })
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
    await this.farm.add(new BN('20'), this.lpToken1.address, true, {
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
  it('keeps track of length in pool', async () => {
    await this.farm.add(new BN('20'), this.lpToken1.address, true, {
      from: admin1
    })

    const mintAmount1 = ether('10')
    await this.lpToken1.mint(user1, mintAmount1)
    await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user1 })
    const user1Tracker = await trackBalance(this.farmToken, user1)

    const mintAmount2 = mintAmount1.mul(new BN('2'))
    const totalMinted = mintAmount1.add(mintAmount2)
    await this.lpToken1.mint(user2, mintAmount2)
    await this.lpToken1.approve(this.farm.address, MAX_UINT256, { from: user2 })
    const user2Tracker = await trackBalance(this.farmToken, user2)

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
