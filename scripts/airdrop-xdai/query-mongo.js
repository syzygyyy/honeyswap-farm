const web3 = require('./web3')()
const { connectDB } = require('./mongoose')(web3)

async function main() {
  await connectDB()

  process.exit(0)
}
main()
