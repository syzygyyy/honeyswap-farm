const BN = require('bn.js')
const web3 = require('./web3')()
const { connectDB, Transfer, ASCENDING } = require('./mongoose')(web3)
const { constants, saveJson, loadJson, uniFarmFactories, ether } = require('./utils')(web3)
const { ZERO_ADDRESS, SCALE } = constants

const BLACKLIST_SRC = './blacklist-info.json'
const ZERO = new BN('0')
const getBN = (obj, key) => obj[key] ?? ZERO

const blacklistInfo = loadJson(BLACKLIST_SRC)

async function getLogIndexParams(pair, toBlock) {
  const match = { $match: { pair, blockNumber: { $lte: toBlock } } }
  const logIndices = await Transfer.aggregate([
    match,
    {
      $group: { _id: null, minLogIndex: { $min: '$logIndex' }, maxLogIndex: { $max: '$logIndex' } }
    }
  ])
  if (logIndices.length === 0) {
    console.error('ERROR: no transfers found')
    process.exit(1)
  }
  const { minLogIndex, maxLogIndex } = logIndices[0]
  return {
    logIndexDelta: minLogIndex,
    blockNumShift: maxLogIndex - minLogIndex + 1
  }
}

async function getBlacklistedAddresses(pair) {
  const cachedBlacklist = blacklistInfo.cachedBlacklists[pair]
  if (cachedBlacklist) {
    return new Set(cachedBlacklist)
  }
  const uniPoolsRes = await Promise.all(
    uniFarmFactories.map(async (farmFactory) => {
      const { pool } = await farmFactory.methods.pools(pair).call()
      return pool
    })
  )
  const newBlacklistedAddresses = new Set(
    [...uniPoolsRes, ...blacklistInfo.otherFarms].filter((address) => address !== ZERO_ADDRESS)
  )
  blacklistInfo.cachedBlacklists[pair] = [...newBlacklistedAddresses]
  saveJson(BLACKLIST_SRC, blacklistInfo, [null, 2])
  return newBlacklistedAddresses
}

async function getPairRewards(pair, toBlock) {
  const blacklistedAddresses = await getBlacklistedAddresses(pair)

  const { logIndexDelta, blockNumShift } = await getLogIndexParams(pair, toBlock)
  const transfers = await Transfer.aggregate([
    { $match: { pair, blockNumber: { $lte: toBlock } } },
    {
      $project: {
        absoluteIndex: {
          $add: [
            { $multiply: ['$blockNumber', blockNumShift] },
            { $subtract: ['$logIndex', logIndexDelta] }
          ]
        },
        from: true,
        to: true,
        value: true,
        blockNumber: true
        // logIndex: true
      }
    },
    { $sort: { absoluteIndex: ASCENDING } },
    { $skip: 1 }, // skip 0x -> 0x mint
    { $project: { absoluteIndex: false } }
  ])

  const newRewards = {}
  const balances = {}
  const userDebt = {}
  let totalSupply = ZERO
  let totalAccumulator = ZERO

  let lastBlock = transfers[transfers.length - 1].blockNumber
  console.log('lastBlock: ', lastBlock)
  // const finalBlock = 9
  const finalBlock = toBlock

  const setRewards = (user, rewards) => {
    if (rewards.lt(ZERO) || !BN.isBN(rewards)) {
      console.log('user: ', user)
      console.log('rewards: ', rewards.toString())
      console.log('totalAccumulator: ', totalAccumulator.toString())
      console.log('lastBlock: ', lastBlock)
      console.log('totalSupply: ', totalSupply.toString())
      console.log('ERROR: Setting negative rewards')
      process.exit(1)
    }
    newRewards[user] = rewards
  }

  const accountRewards = (user) => {
    const userBalance = getBN(balances, user)
    if (userBalance.gt(ZERO)) {
      const debt = getBN(userDebt, user)
      setRewards(user, getBN(newRewards, user).add(totalAccumulator.mul(userBalance)).sub(debt))
    }
  }

  const setBalance = (user, newUserBalance) => {
    accountRewards(user)
    userDebt[user] = totalAccumulator.mul(newUserBalance)
    balances[user] = newUserBalance
  }

  const increaseBalance = (user, amount) => {
    setBalance(user, getBN(balances, user).add(amount))
  }

  const decreaseBalance = (user, amount) => {
    setBalance(user, getBN(balances, user).sub(amount))
  }

  const updateAccumulator = (currentBlockNumber) => {
    // increase accumulator
    if (totalSupply.gt(new BN('0'))) {
      const blocksPassed = new BN(currentBlockNumber - lastBlock)
      totalAccumulator = totalAccumulator.add(blocksPassed.mul(SCALE).div(totalSupply))
    }
    lastBlock = currentBlockNumber
  }

  for (let { from, to, value, blockNumber } of transfers) {
    if (blockNumber > toBlock) break
    value = new BN(value)

    updateAccumulator(blockNumber)

    if (blacklistedAddresses.has(from) || blacklistedAddresses.has(to)) {
      continue
    }

    if (from === ZERO_ADDRESS) {
      // mint
      totalSupply = totalSupply.add(value)
      increaseBalance(to, value)
    } else if (to === ZERO_ADDRESS) {
      // burn
      totalSupply = totalSupply.sub(value)
      decreaseBalance(from, value)
    } else {
      // simple transfer
      decreaseBalance(from, value)
      increaseBalance(to, value)
    }
  }
  if (lastBlock != finalBlock) {
    updateAccumulator(finalBlock)
  }

  let totalRewards = ZERO
  for (const [user, userBalance] of Object.entries(balances)) {
    if (userBalance.gt(ZERO)) {
      decreaseBalance(user, userBalance)
    }
    totalRewards = totalRewards.add(newRewards[user] ?? ZERO)
  }

  const finalNewRewards = []
  for (const [user, userRewards] of Object.entries(newRewards)) {
    finalNewRewards[user] = userRewards.mul(SCALE).div(totalRewards)
  }

  return finalNewRewards
}

async function main() {
  await connectDB()

  const { totalTokens: directTotalTokens, toBlock, pairs: pairInput } = loadJson(
    './snapshot-input.json'
  )
  const totalTokens = ether(directTotalTokens)
  const pairs = {}

  for (const [pair, weight] of Object.entries(pairInput)) {
    pairs[web3.utils.toChecksumAddress(pair)] = ether(weight)
  }
  const rewards = {}

  const totalPairs = Object.keys(pairInput).length
  let currentPair = 0
  let totalRewards = ZERO
  for (const [pair, weight] of Object.entries(pairs)) {
    console.log(`\n${++currentPair}/${totalPairs} ${pair}`)
    const newRewards = await getPairRewards(pair, toBlock)
    for (const [user, userPairRewardsShare] of Object.entries(newRewards)) {
      const additionalRewards = userPairRewardsShare.mul(weight)
      rewards[user] = (rewards[user] ?? ZERO).add(additionalRewards)
      totalRewards = totalRewards.add(additionalRewards)
    }
  }

  const finalRewards = {}
  let totalGivenRewards = ZERO
  for (const [user, userRewards] of Object.entries(rewards)) {
    const actualRewards = userRewards.mul(totalTokens).div(totalRewards)
    if (actualRewards.gt(ZERO)) {
      finalRewards[user] = actualRewards
      totalGivenRewards = totalGivenRewards.add(actualRewards)
    }
  }

  console.log('totalTokens: ', web3.utils.fromWei(totalTokens))
  console.log('totalGivenRewards: ', web3.utils.fromWei(totalGivenRewards))

  if (totalGivenRewards.gt(totalTokens)) {
    throw new Error('Snapshot distributing too many tokens')
  }

  console.log('individual addresses:', Object.keys(finalRewards).length)

  const outputFile = process.argv[2]
  saveJson(outputFile, finalRewards, [null, 2])
}

main().then(() => process.exit(0))
