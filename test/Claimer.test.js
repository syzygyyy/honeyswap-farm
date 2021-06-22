const { contract, accounts, web3 } = require('@openzeppelin/test-environment')
const { time, constants, expectEvent, expectRevert } = require('@openzeppelin/test-helpers')
const { MAX_UINT256 } = constants
const { ether, trackBalance, merkleUtils, bnSum } = require('./utils')(web3)
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
  })
})
