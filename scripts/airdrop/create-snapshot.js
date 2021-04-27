const web3 = require('./web3')()
const { connectDB, Transfer, ASCENDING } = require('./mongoose')(web3)
const { constants, saveJson } = require('./utils')(web3)
const { ZERO_ADDRESS, SCALE } = constants
const BN = require('bn.js')
const fs = require('fs')

async function main() {
  await connectDB()
  const [, , pairAddress, outputFile] = process.argv
  const matchPair = { $match: { pair: pairAddress } }

  let res = await Transfer.aggregate([
    matchPair,
    {
      $group: { _id: null, minLogIndex: { $min: '$logIndex' }, maxLogIndex: { $max: '$logIndex' } }
    }
  ])
  if (res.length === 0) {
    console.error('ERROR: no transfers found')
    process.exit(1)
  }
  const { minLogIndex, maxLogIndex } = res[0]
  const logIndexDelta = minLogIndex
  const blockNumShift = maxLogIndex - minLogIndex + 1

  res = await Transfer.aggregate([
    matchPair,
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

  const emtpyBnObj = () => {
    const newObj = {}
    newObj.get = (address) => newObj[address] ?? new BN('0')
    return newObj
  }

  const ONE = new BN('1').mul(SCALE)
  const ZERO = new BN('0')

  const rewards = {}
  const balances = emtpyBnObj()
  const userDebt = emtpyBnObj()
  let totalSupply = ZERO
  let totalAccumulator = ZERO

  const user1 = '0xa4e766870cb00f6f02f36754C0Da8995E0e5BA91'
  const user2 = '0x5870b0527DeDB1cFBD9534343Feda1a41Ce47766'

  const res2 = [
    {
      from: ZERO_ADDRESS,
      to: user1,
      value: new BN('2').mul(SCALE),
      blockNumber: 2
    },
    {
      from: user1,
      to: user2,
      value: new BN('1').mul(SCALE),
      blockNumber: 3
    },
    {
      from: user2,
      to: ZERO_ADDRESS,
      value: new BN('1').mul(SCALE),
      blockNumber: 4
    },
    {
      from: user1,
      to: ZERO_ADDRESS,
      value: new BN('1').mul(SCALE),
      blockNumber: 4
    },
    {
      from: ZERO_ADDRESS,
      to: user2,
      value: new BN('123').mul(SCALE),
      blockNumber: 8
    }
  ]

  const transfers = res

  let lastBlock = transfers[0].blockNumber
  // const finalBlock = 9
  const finalBlock = transfers[transfers.length - 1].blockNumber

  const setRewards = (user, newRewards) => {
    if (newRewards.lt(ZERO)) {
      console.log('user: ', user)
      console.log('newRewards: ', newRewards.toString())
      console.log('totalAccumulator: ', totalAccumulator.toString())
      console.log('lastBlock: ', lastBlock)
      console.log('totalSupply: ', totalSupply.toString())
      console.log('ERROR: Setting negative rewards')
      process.exit(1)
    }
    rewards[user] = newRewards
  }

  const accountRewards = (user) => {
    const userBalance = balances.get(user)
    if (userBalance.gt(ZERO)) {
      setRewards(
        user,
        (rewards[user] ?? new BN('0'))
          .add(totalAccumulator.mul(userBalance))
          .sub(userDebt.get(user))
      )
    }
  }

  const setBalance = (user, newUserBalance) => {
    accountRewards(user)
    userDebt[user] = totalAccumulator.mul(newUserBalance)
    balances[user] = newUserBalance
  }

  const increaseBalance = (user, amount) => {
    setBalance(user, balances.get(user).add(amount))
  }

  const decreaseBalance = (user, amount) => {
    setBalance(user, balances.get(user).sub(amount))
  }

  const updateAccumulator = (currentBlockNumber) => {
    // increase accumulator
    if (totalSupply.gt(new BN('0'))) {
      const blocksPassed = new BN(currentBlockNumber - lastBlock)
      totalAccumulator = totalAccumulator.add(blocksPassed.mul(ONE).mul(SCALE).div(totalSupply))
    }
    lastBlock = currentBlockNumber
  }

  for (let { from, to, value, blockNumber } of transfers) {
    value = new BN(value)

    updateAccumulator(blockNumber)

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

  for (const user of Object.keys(rewards)) {
    const userBalance = balances.get(user)
    if (userBalance.gt(ZERO)) {
      decreaseBalance(user, userBalance)
    }
    const userRewards = rewards[user]
    console.log(`${user}: ${web3.utils.fromWei(userRewards.div(SCALE))}`)
  }
  saveJson(outputFile, rewards)

  process.exit(0)
}

main()
