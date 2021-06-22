const web3 = require('./web3')()
const { connectDB, Transfer, Address } = require('./mongoose')(web3)
const { removeDuplicateTransfers, getDuplicates } = require('./utils')(web3)

async function main() {
  await connectDB()

  const pairAddress = web3.utils.toChecksumAddress(process.argv[2])
  console.log('pair:', pairAddress)
  await removeDuplicateTransfers(Transfer, pairAddress)

  const dups = await getDuplicates(Address, {}, ['address'])
  if (dups) {
    await Address.deleteMany({ _id: { $in: dups.dups } })
  } else {
    console.log('no duplicate addresses found')
  }

  process.exit(0)
}
main()
