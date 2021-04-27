module.exports = (web3) => {
  const fs = require('fs')
  const BN = require('bn.js')

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const SCALE = new BN('10').pow(new BN('18'))

  function loadJson(fp) {
    return JSON.parse(fs.readFileSync(fp))
  }

  function saveJson(fp, obj) {
    fs.writeFileSync(fp, JSON.stringify(obj))
  }

  const factory = new web3.eth.Contract(
    loadJson('./abis/factory-abi.json'),
    '0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7'
  )

  const loadPair = async (pairAddress) => {
    const pair = new web3.eth.Contract(loadJson('./abis/pair-abi.json'), pairAddress)
    pair.token0 = await pair.methods.token0().call()
    pair.token1 = await pair.methods.token1().call()
    return pair
  }

  async function getPastLogs(
    contract,
    event,
    options,
    fromBlock,
    finalToBlock,
    spacing,
    eventProcessor
  ) {
    console.log('fromBlock: ', fromBlock)
    console.log('finalToBlock: ', finalToBlock)
    let toBlock
    eventProcessor = eventProcessor ?? ((event) => event)
    const eventChunks = []
    do {
      toBlock = Math.min(fromBlock + spacing, finalToBlock)
      console.log('fromBlock: ', fromBlock)
      console.log('toBlock: ', toBlock)
      const newEvents = await contract.getPastEvents(event, { ...options, fromBlock, toBlock })
      eventChunks.push(await Promise.all(newEvents.map(eventProcessor)))
      fromBlock = toBlock + 1
    } while (toBlock < finalToBlock)
    return eventChunks
  }

  const getDuplicates = async (Model, match, uniqueFields) => {
    const uniqueId = {}
    for (let field of uniqueFields) {
      uniqueId[field] = `$${field}`
    }
    const [res] = await Model.aggregate([
      { $match: match },
      {
        $group: {
          _id: uniqueId,
          dups: { $addToSet: '$_id' },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } },
      { $project: { dups: { $slice: ['$dups', 1, { $subtract: [{ $size: '$dups' }, 1] }] } } },
      { $unwind: '$dups' },
      { $project: { _id: false, count: false } },
      { $group: { _id: null, dups: { $push: '$dups' } } }
    ])
    return res
  }

  const removeDuplicateTransfers = async (Transfer, pairAddress) => {
    const duplicates = await getDuplicates(Transfer, { pair: pairAddress }, [
      'logIndex',
      'blockNumber'
    ])
    if (duplicates) {
      await Transfer.deleteMany({ _id: { $in: duplicates.dups } })
      console.log(`removed ${duplicates.dups.length} duplicates`)
    } else {
      console.log('no duplicate transfers found')
    }
  }

  const getHighestBlock = async (Transfer, pairAddress) => {
    const res = await Transfer.aggregate([
      { $group: { _id: { pair: '$pair' }, highestBlock: { $max: '$blockNumber' } } },
      { $match: { _id: { pair: pairAddress } } }
    ])
    return res[0]
  }

  return {
    loadJson,
    saveJson,
    getPastLogs,
    factory,
    loadPair,
    removeDuplicateTransfers,
    getHighestBlock,
    getDuplicates,
    constants: {
      ZERO_ADDRESS,
      SCALE
    }
  }
}
