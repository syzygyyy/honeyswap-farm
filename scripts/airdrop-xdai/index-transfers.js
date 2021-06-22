const web3 = require('./web3')()
const { connectDB } = require('./mongoose')(web3)
const { indexPairTransfers } = require('./pair-utils')(web3)

async function main() {
  await connectDB()
  console.log('indexing transfers')
  const pair = process.argv[2]
  console.log('pair: ', pair)
  await indexPairTransfers(pair)
  console.log('done')

  process.exit(0)
}
main()
