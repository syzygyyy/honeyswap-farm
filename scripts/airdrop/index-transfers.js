const BN = require('bn.js')
const web3 = require('./web3')()
const {
  getPastLogs,
  factory,
  loadPair,
  removeDuplicateTransfers,
  getHighestBlock
} = require('./utils')(web3)
const { connectDB, Transfer, isContract } = require('./mongoose')(web3)

async function getPairSnapshot(pairAddress) {
  pairAddress = web3.utils.toChecksumAddress(pairAddress)
  if (!(await isContract(pairAddress))) {
    throw Error(`${pairAddress} is not contract`)
  }

  const pair = await loadPair(pairAddress)
  const interval = 24 * 60 * 12 * 4

  let firstBlock
  const res = await getHighestBlock(Transfer, pairAddress)
  const highestBlock = res?.highestBlock
  if (highestBlock) {
    firstBlock = highestBlock - interval
  } else {
    const [createdEvent] = await factory.getPastEvents('PairCreated', {
      filter: {
        token0: pair.token0,
        token1: pair.token1
      },
      fromBlock: 11813493 // factory creation block
    })
    firstBlock = createdEvent.blockNumber
  }

  const latestBlock = await web3.eth.getBlockNumber()

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
      await isContract(from)
      await isContract(to)
      const transfer = new Transfer(transferData)
      await transfer.save()
      return transferData
    }
  )
  console.log(
    'total events:',
    eventChunks.reduce((total, chunk) => total + chunk.length, 0)
  )
  await removeDuplicateTransfers(Transfer, pairAddress)
}

async function main() {
  await connectDB()
  console.log('indexing transfers')
  const pair = process.argv[2]
  console.log('pair: ', pair)
  await getPairSnapshot(pair)
  console.log('done')

  process.exit(0)
}
main()
