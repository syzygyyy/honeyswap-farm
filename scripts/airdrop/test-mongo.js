const web3 = require('./web3')()
const { connectDB, isContract } = require('./mongoose')(web3)

async function main() {
  await connectDB()
  const res = await isContract('0xa4e766870cb00f6f02f36754C0Da8995E0e5BA91')
  console.log('res: ', res)

  process.exit(0)
}
main()
