const web3 = require('./web3')()
const { connectDB, Address } = require('./mongoose')(web3)

async function main() {
  await connectDB()

  const me = new Address({
    address: '0x6fF546eC084962Ac2A7962b0f94d5f766e467aF4',
    isContract: true
  })
  await me.save()

  process.exit(0)
}
main()
