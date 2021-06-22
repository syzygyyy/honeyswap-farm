module.exports = (web3, mongoose) => {
  const {
    getPastLogs,
    pairFactory,
    loadPair,
    removeDuplicateTransfers,
    getHighestBlock
  } = require('./utils')(web3)
  const { Transfer, isContract } = mongoose

  async function indexPairTransfers(pairAddress, tillBlock) {
    pairAddress = web3.utils.toChecksumAddress(pairAddress)
    if (!(await isContract(pairAddress))) {
      throw Error(`${pairAddress} is not contract`)
    }

    const pair = await loadPair(pairAddress)
    const interval = 24 * 60 * 12 * 2

    let firstBlock
    const res = await getHighestBlock(Transfer, pairAddress)
    const highestBlock = res?.highestBlock
    if (highestBlock) {
      firstBlock = highestBlock - interval
    } else {
      const [createdEvent] = await pairFactory.getPastEvents('PairCreated', {
        filter: {
          token0: pair.token0,
          token1: pair.token1
        },
        fromBlock: 11813493 // factory creation block
      })
      firstBlock = createdEvent.blockNumber
    }

    const toBlock = tillBlock ?? (await web3.eth.getBlockNumber())

    const eventChunks = await getPastLogs(
      pair,
      'Transfer',
      {},
      firstBlock,
      toBlock,
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
        // await isContract(from)
        // await isContract(to)
        const transfer = new Transfer(transferData)
        // await transfer.save()
        transfer.save()
        return transferData
      }
    )
    console.log(
      'total events:',
      eventChunks.reduce((total, chunk) => total + chunk.length, 0)
    )
    await removeDuplicateTransfers(Transfer, pairAddress)
  }

  return {
    indexPairTransfers
  }
}
