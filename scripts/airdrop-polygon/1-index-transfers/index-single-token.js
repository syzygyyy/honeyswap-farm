const INTERVAL = (60 / 2) * 60 * 24 * 0.5

module.exports = (web3, { Transfer }) => {
  const { getPastLogs } = require('../utils.js')(web3)

  const transferFromEvent = (token) => ({
    blockNumber,
    logIndex,
    transactionHash,
    returnValues: { from, to, value }
  }) => ({
    blockNumber,
    chain: web3.chain,
    transactionHash,
    logIndex,
    token,
    from,
    to,
    value
  })

  const indexSingleToken = async (token, tokenContract, startBlock, endBlock) => {
    const createTransferFromEvent = transferFromEvent(token)

    const transfers = await getPastLogs(
      tokenContract,
      'Transfer',
      {},
      startBlock,
      endBlock,
      INTERVAL,
      async (eventChunk) => {
        const transfers = eventChunk.map(createTransferFromEvent)
        await Transfer.insertMany(transfers)
      }
    )
    console.log('transfers.length: ', transfers.length)
  }

  return indexSingleToken
}
