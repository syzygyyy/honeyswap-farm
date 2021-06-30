const { tokens } = require('../reward-map.js')
const web3 = require('../web3.js')()
const mongoose = require('../mongoose.js')
const indexSingleToken = require('./index-single-token.js')(mongoose)
const PairAbi = require('../artifacts/pair-abi.json')
const { getBlockHeightFromDate } = require('../utils.js')(web3)

const getAddresses = (tokens, timeframe) => tokens.map(({ address }) => ({ address, timeframe }))

async function indexToken({ address, timeframe: { end } }) {
  const endBlock = await getBlockHeightFromDate(end)
  const tokenContract = new web3.eth.Contract(PairAbi, address)
  await indexSingleToken(address, tokenContract, endBlock)
}

async function main() {
  await mongoose.connectDB()
  const allTokens = tokens.reduce(
    (allTokens, { tokens, timeframe }) => allTokens.concat(getAddresses(tokens, timeframe)),
    []
  )

  // const block = await getBlockHeightFromDate('01-04-2021')
  // console.log('block: ', block)
  // console.log(
  //   'await getBlockHeightFromDate("01-04-2021"): ',
  //   await getBlockHeightFromDate('01-04-2021')
  // )

  await tokens[0].getCreatedAt(web3, tokens[0].tokens[0].address)

  // await indexToken(allTokens[0])
  // await Promise.all(allTokens.map(indexToken))
}

main().then(() => process.exit(0))
