module.exports = ({ chain }, { Transfer, ASCENDING }) => {
  const createMatch = (token) => ({ token, chain })

  async function getLogIndexParams(token) {
    const logIndices = await Transfer.aggregate([
      { $match: createMatch(token) },
      {
        $group: {
          _id: null,
          minLogIndex: { $min: '$logIndex' },
          maxLogIndex: { $max: '$logIndex' }
        }
      }
    ])
    if (logIndices.length === 0) {
      console.error('ERROR: no transfers found')
      process.exit(1)
    }
    const { minLogIndex, maxLogIndex } = logIndices[0]
    return {
      logIndexDelta: minLogIndex,
      blockNumShift: maxLogIndex - minLogIndex + 1
    }
  }

  const DEFAULT_INTERVAL = 10000

  async function* getTransfers(token, startBlock, endBlock, interval = DEFAULT_INTERVAL) {
    const { logIndexDelta, blockNumShift } = await getLogIndexParams(token)
    let transfersChunk = null
    let skip = 0
    do {
      const limit = interval
      console.log('skip: ', skip)
      console.log('limit: ', limit)
      transfersChunk = await Transfer.aggregate([
        { $match: { ...createMatch(token), blockNumber: { $gte: startBlock, $lte: endBlock } } },
        {
          $project: {
            absoluteIndex: {
              $add: [
                { $multiply: ['$blockNumber', blockNumShift] },
                { $subtract: ['$logIndex', logIndexDelta] }
              ]
            },
            from: true,
            to: true,
            value: true,
            blockNumber: true
            // logIndex: true
          }
        },
        { $sort: { absoluteIndex: ASCENDING } },
        { $skip: 1 }, // skip 0x -> 0x mint
        { $project: { absoluteIndex: false } },
        { $skip: skip },
        { $limit: limit }
      ]).allowDiskUse(true)

      console.log('transfersChunk.length: ', transfersChunk.length)
      if (transfersChunk.length > 0) yield transfersChunk
      skip += interval
    } while (transfersChunk.length > 0)
  }

  return getTransfers
}
