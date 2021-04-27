const BN = require('bn.js')
const web3 = require('./web3')()
const { getPastLogs, factory, loadPair } = require('./utils')(web3)
const { connectDB, Transfer, isContract } = require('./mongoose')(web3)

async function getPairSnapshot(pairAddress) {
  pairAddress = web3.utils.toChecksumAddress(pairAddress)
  console.log('1')
  if (!(await isContract(pairAddress))) {
    throw Error(`${pairAddress} is not contract`)
  }

  console.log('2')
  const pair = await loadPair(pairAddress)
  console.log('3')
  const [createdEvent] = await factory.getPastEvents('PairCreated', {
    filter: {
      token0: pair.token0,
      token1: pair.token1
    },
    fromBlock: 11813493 // factory creation block
  })

  console.log('4')
  const firstBlock = createdEvent.blockNumber
  const latestBlock = await web3.eth.getBlockNumber()

  console.log('5')
  const interval = 24 * 60 * 12 * 4
  const eventChunks = await getPastLogs(
    pair,
    'Transfer',
    {},
    firstBlock,
    latestBlock,
    interval,
    async ({ blockNumber, logIndex, transactionHash, returnValues: { from, to, value } }) => {
      const transferData = {
        blockNumber,
        transactionHash,
        logIndex,
        pair: pairAddress,
        from,
        to,
        value
      }
      const transfer = new Transfer(transferData)
      await transfer.save()
      return transferData
    }
  )
  console.log(
    'total events:',
    eventChunks.reduce((total, chunk) => total + chunk.length, 0)
  )
}

async function main() {
  await connectDB()
  //await getPairSnapshot('0x0f08163cd6b91ece1f4184ec40093b9a04fde96b')
  console.log('indexing transfers')
  await getPairSnapshot('0x7bea4af5d425f2d4485bdad1859c88617df31a67')
  console.log('done')
}
main()
