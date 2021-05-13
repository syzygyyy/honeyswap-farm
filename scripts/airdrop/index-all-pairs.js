const web3 = require('./web3')()
const mongoose = require('./mongoose')(web3)
const { connectDB } = mongoose
const { loadJson } = require('./utils')(web3)
const { indexPairTransfers } = require('./pair-utils')(web3, mongoose)

async function main() {
  console.log('connecting')
  await connectDB()
  console.log('starting')
  const snapshotInput = loadJson('./snapshot-input.json')

  const totalPairs = Object.keys(snapshotInput.pairs).length
  let i = 0
  for (const pair of Object.keys(snapshotInput.pairs)) {
    console.log(`pair (${++i}/${totalPairs}): `, pair)
    await indexPairTransfers(pair, snapshotInput.toBlock)
  }
}

main().then(() => process.exit(0))
