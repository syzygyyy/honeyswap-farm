const web3 = require('./web3.js')()
const { getBlockHeightFromDate } = require('./utils.js')(web3)

async function main() {
  const [, , date] = process.argv
  const block = await getBlockHeightFromDate(date)
  console.log('block: ', block)
}

main().then(() => process.exit(0))
