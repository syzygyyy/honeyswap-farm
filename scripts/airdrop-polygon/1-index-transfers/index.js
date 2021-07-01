const { allocations } = require('../reward-map.js')
const web3 = require('../web3.js')()
const mongoose = require('../mongoose.js')
const indexSingleToken = require('./index-single-token.js')(web3, mongoose)
const PairAbi = require('../artifacts/pair-abi.json')
const { Transfer } = mongoose

const getAddresses = (tokens, timeframe) => tokens.map((token) => ({ ...token, timeframe }))

const getHighestBlock = async (token) => {
  const res = await Transfer.aggregate([
    { $group: { _id: { token: '$token' }, highestBlock: { $max: '$blockNumber' } } },
    { $match: { _id: { token } } }
  ])
  return res?.[0]?.highestBlock ?? -1
}

let i = 0
async function indexToken({ address, timeframe: { end }, createdAt }, total) {
  console.log('\n\n\ntoken:', address)
  console.log(`${++i}/${total}`)
  const highestBlock = await getHighestBlock(address)
  const tokenContract = new web3.eth.Contract(PairAbi, address)
  try {
    await indexSingleToken(address, tokenContract, Math.max(createdAt, highestBlock + 1), end)
  } catch (err) {
    console.log('no more space')
    console.log('err: ', JSON.stringify(err).slice(0, 1000))
    throw new Error('done')
  }
}

async function main() {
  await mongoose.connectDB()
  const allTokens = allocations
    .reduce(
      (allTokens, { tokens, timeframe }) => allTokens.concat(getAddresses(tokens, timeframe)),
      []
    )
    .map(({ address, ...token }) => ({ address: web3.utils.toChecksumAddress(address), ...token }))

  // const block = await getBlockHeightFromDate('01-04-2021')
  // console.log('block: ', block)
  // console.log(
  //   'await getBlockHeightFromDate("01-04-2021"): ',
  //   await getBlockHeightFromDate('01-04-2021')
  // )

  // await indexToken(allTokens[0])
  for (const token of allTokens) {
    await indexToken(token, allTokens.length)
  }
}

main().then(() => process.exit(0))
