const { contract, accounts, web3 } = require('@openzeppelin/test-environment')
const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers')
const { MAX_UINT256 } = constants
const { ether, trackBalance, merkleUtils, bnSum, ZERO } = require('./utils')(web3)
const { expect } = require('chai')

const [admin, attacker, user1, user2, user3] = accounts

const TestERC20 = contract.fromArtifact('TestERC20')
const StreamedAirdropper = contract.fromArtifact('StreamedAirdropper')
const Claimer = contract.fromArtifact('Claimer')

describe('Claimer', () => {
  before(async () => {
    this.token = await TestERC20.new()
    const currentTime = await time.latest()
    this.start = currentTime.add(time.duration.days(2))
    this.end = this.start.add(time.duration.days(180))
    this.airdropper = await StreamedAirdropper.new(this.token.address, this.start, this.end)

    const recipients = {
      [user1]: ether('4'),
      [user2]: ether('3'),
      [user3]: ether('8'),
      [attacker]: ether('2.1')
    }
    this.snapshot = merkleUtils.createSnapshot(recipients)

    this.claimEnd = this.start.add(time.duration.years(1))
    this.upfrontShare = ether('0.1')
    this.claimer = await Claimer.new(
      this.airdropper.address,
      this.snapshot.root,
      this.token.address,
      this.claimEnd,
      this.upfrontShare,
      { from: admin }
    )
    this.scale = await this.claimer.SCALE()

    const total = bnSum(...Object.values(recipients))
    await this.token.mint(this.claimer.address, total)
  })
  describe('initialization', () => {
    it('stores correct constants', async () => {
      expect(await this.claimer.airdropper()).to.equal(this.airdropper.address)
      expect(await this.claimer.merkleRoot()).to.equal(this.snapshot.root)
      expect(await this.claimer.token()).to.equal(this.token.address)
      expect(await this.claimer.claimEnd()).to.be.bignumber.equal(this.claimEnd)
      expect(await this.claimer.upfrontShare()).to.be.bignumber.equal(this.upfrontShare)
      expect(await this.claimer.SCALE()).to.be.bignumber.equal(ether('1'))
    })
  })
  describe('standard functionality', () => {
    it('creates valid leafs', async () => {
      for (const [addr, { amount }] of Object.entries(this.snapshot.accounts)) {
        expect(merkleUtils.createLeaf(addr, amount)).to.equal(await this.claimer.createClaimLeaf(addr, amount))
      }
    })
    it('allows user to claim', async () => {
      const claimerTracker = await trackBalance(this.token, this.claimer.address)
      const balTracker = await trackBalance(this.token, user1)
      const proof = merkleUtils.createProof(this.snapshot, user1)
      const amount = this.snapshot.accounts[user1].amount
      const receipt = await this.claimer.claimTo(user1, proof, amount, { from: user1 })
      expectEvent(receipt, 'Claimed', { claimer: user1, recipient: user1, amount })
      const upfrontAmount = amount.mul(this.upfrontShare).div(this.scale)
      await expectEvent.inTransaction(receipt.tx, this.airdropper, 'VestingAdded', {
        user: user1,
        amount: amount.sub(upfrontAmount)
      })
      expect(await claimerTracker.delta()).to.be.bignumber.equal(amount.neg())
      expect(await balTracker.delta()).to.be.bignumber.equal(upfrontAmount)
      const leaf = merkleUtils.createLeaf(user1, amount)
      expect(await this.claimer.hasAlreadyClaimed(leaf)).to.be.true
    })
    it('allows user to claim to another', async () => {
      const balTracker1 = await trackBalance(this.token, user1)
      const balTracker2 = await trackBalance(this.token, user2)
      const proof = merkleUtils.createProof(this.snapshot, user2)
      const amount = this.snapshot.accounts[user2].amount
      const receipt = await this.claimer.claimTo(user1, proof, amount, { from: user2 })
      expectEvent(receipt, 'Claimed', { claimer: user2, recipient: user1, amount })
      const upfrontAmount = amount.mul(this.upfrontShare).div(this.scale)
      await expectEvent.inTransaction(receipt.tx, this.airdropper, 'VestingAdded', {
        user: user1,
        amount: amount.sub(upfrontAmount)
      })
      expect(await balTracker1.delta()).to.be.bignumber.equal(upfrontAmount)
      expect(await balTracker2.delta()).to.be.bignumber.equal(ZERO)
      const leaf = merkleUtils.createLeaf(user2, amount)
      expect(await this.claimer.hasAlreadyClaimed(leaf)).to.be.true
    })
    it('prevents double claim', async () => {
      const proof = merkleUtils.createProof(this.snapshot, attacker)
      const amount = this.snapshot.accounts[attacker].amount
      await this.claimer.claimTo(attacker, proof, amount, { from: attacker })
      const leaf = merkleUtils.createLeaf(attacker, amount)
      expect(await this.claimer.hasAlreadyClaimed(leaf)).to.be.true
      await expectRevert(
        this.claimer.claimTo(attacker, proof, amount, { from: attacker }),
        'Claimer: Has already claimed'
      )
    })
    it('prevents another user from claiming', async () => {
      const proof = merkleUtils.createProof(this.snapshot, user3)
      const amount = this.snapshot.accounts[user3].amount
      await expectRevert(
        this.claimer.claimTo(attacker, proof, amount, { from: attacker }),
        'Claimer: Invalid proof'
      )
    })
    it('prevents owner from emptying airdropper before claim end', async () => {
      await expectRevert(
        this.claimer.emptyTo(attacker, { from: admin }),
        'Claimer: Claim period ongoing'
      )
    })
  })
  describe('after claim period end', () => {
    before(async () => {
      await time.increaseTo(this.claimEnd)
    })
    it('prevents valid claims after claim end', async () => {
      const amount = this.snapshot.accounts[user3].amount
      const leaf = merkleUtils.createLeaf(user3, amount)
      expect(await this.claimer.hasAlreadyClaimed(leaf)).to.be.false
      const proof = merkleUtils.createProof(this.snapshot, user3)
      await expectRevert(
        this.claimer.claimTo(user3, proof, amount, { from: user3 }),
        'Claimer: Claim has expired'
      )
    })
    it('only allows owner to empty claim contract', async () => {
      await expectRevert(
        this.claimer.emptyTo(attacker, { from: attacker }),
        'Ownable: caller is not the owner'
      )
      const claimerTracker = await trackBalance(this.token, this.claimer.address)
      const adminTracker = await trackBalance(this.token, admin)
      const amount = this.snapshot.accounts[user3].amount
      expect(await claimerTracker.get()).to.be.bignumber.equal(amount)
      const receipt = await this.claimer.emptyTo(admin, { from: admin })
      expectEvent(receipt, 'Emptied', { emptier: admin, recipient: admin, amount })
      expect(await adminTracker.delta()).to.be.bignumber.equal(amount)
      expect(await claimerTracker.delta()).to.be.bignumber.equal(amount.neg())
    })
  })
})
