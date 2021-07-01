module.exports = (web3, mongoose) => {
  const BN = require('bn.js')
  const getTransfers = require('./get-transfers.js')(web3, mongoose)
  const { ether, constants } = require('../utils.js')(web3)
  const { ZERO_ADDRESS, SCALE } = constants

  const ZERO = new BN('0')
  const getBN = (obj, key) => obj[key] ?? ZERO

  async function asyncReduce(arr, fn, acc) {
    for (const val of arr) {
      acc = await fn(acc, val)
    }
    return acc
  }

  async function weighHoldings(
    weightedBalances,
    { address: token, weight, createdAt: startBlock },
    { start: snapshotStart, end: snapshotEnd },
    { ignoreAddresses, removeAddresses }
  ) {
    const ignoreAddressSet = new Set(ignoreAddresses)
    const removeAddressSet = new Set(removeAddresses)

    weight = ether(weight)
    console.log('token: ', token)
    snapshotStart = Math.max(snapshotStart, startBlock)
    let newRewards = {}
    let balances = {}
    let userDebt = {}
    let totalSupply = ZERO
    let totalAccumulator = ZERO
    let lastBlock = null

    function accountRewards(user) {
      const userBalance = getBN(balances, user)
      if (userBalance.gt(ZERO)) {
        const debt = getBN(userDebt, user)
        newRewards[user] = getBN(newRewards, user).add(totalAccumulator.mul(userBalance)).sub(debt)
      }
    }
    function setBalance(user, newUserBalance) {
      accountRewards(user)
      userDebt[user] = totalAccumulator.mul(newUserBalance)
      balances[user] = newUserBalance
    }
    function increaseBalance(user, amount) {
      setBalance(user, getBN(balances, user).add(amount))
    }
    function decreaseBalance(user, amount) {
      setBalance(user, getBN(balances, user).sub(amount))
    }
    function updateAccumulator(blockNumber) {
      const prevUpdateBlock = lastBlock ?? snapshotStart
      if (lastBlock === blockNumber) return
      const blocksPassed = new BN(blockNumber - prevUpdateBlock)
      if (totalSupply.eq(ZERO)) return
      totalAccumulator = totalAccumulator.add(blocksPassed.mul(SCALE).div(totalSupply))
    }

    console.log('startBlock: ', startBlock)
    console.log('snapshotStart: ', snapshotStart)
    console.log('snapshotEnd: ', snapshotEnd)

    const blocks = []
    for await (const transferChunk of getTransfers(token, startBlock, snapshotEnd)) {
      for (const { from, to, value: rawValue, blockNumber } of transferChunk) {
        blocks.push(blockNumber)
        const value = new BN(rawValue)
        if (blockNumber >= snapshotStart) {
          updateAccumulator(blockNumber)
        }
        if (!ignoreAddressSet.has(from) && !ignoreAddressSet.has(to)) {
          if (from === ZERO_ADDRESS) {
            totalSupply = totalSupply.add(value)
            increaseBalance(to, value)
          } else if (to === ZERO_ADDRESS) {
            totalSupply = totalSupply.sub(value)
            decreaseBalance(from, value)
          } else {
            increaseBalance(to, value)
            decreaseBalance(from, value)
          }
        }
        lastBlock = blockNumber
      }
    }
    if (lastBlock < snapshotEnd) updateAccumulator(snapshotEnd)

    let totalRewards = ZERO
    for (const [account, balance] of Object.entries(balances)) {
      if (removeAddressSet.has(account)) continue
      decreaseBalance(account, balance)
      totalRewards = totalRewards.add(getBN(newRewards, account))
    }

    for (const [account, rewards] of Object.entries(newRewards)) {
      if (rewards.eq(ZERO) || removeAddressSet.has(account)) continue
      const existingWeight = getBN(weightedBalances, account)
      const adjustedRewards = rewards.mul(weight).div(totalRewards)
      weightedBalances[account] = existingWeight.add(adjustedRewards)
    }
    return weightedBalances
  }

  async function createSingleSnapshot({ airdrop, timeframe, tokens }, blacklistedAddresses) {
    const totalAirdrop = ether(airdrop)
    let i = 0
    const weightedBalances = await asyncReduce(
      tokens,
      (acc, token) => {
        console.log(`\n${++i}/${tokens.length}`)
        return weighHoldings(acc, token, timeframe, blacklistedAddresses)
      },
      {}
    )
    let totalWeight = new BN('0')
    for (const weightedBalance of Object.values(weightedBalances)) {
      totalWeight = totalWeight.add(weightedBalance)
    }
    const accountAllocations = {}
    let totalAllocated = new BN('0')
    for (const [account, weightedBalance] of Object.entries(weightedBalances)) {
      const allocation = weightedBalance.mul(totalAirdrop).div(totalWeight)
      if (allocation.eq(ZERO)) continue
      accountAllocations[account] = allocation
      totalAllocated = totalAllocated.add(allocation)
    }
    return { accountAllocations, totalAllocated }
  }

  return createSingleSnapshot
}
