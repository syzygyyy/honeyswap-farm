module.exports = (web3) => {
  const fs = require('fs')
  const BN = require('bn.js')

  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
  const SCALE = new BN('10').pow(new BN('36'))

  const ether = (wei) => new BN(web3.utils.toWei(wei.toString()))

  function loadJson(fp) {
    return JSON.parse(fs.readFileSync(fp))
  }

  function saveJson(fp, obj, jsonArgs) {
    jsonArgs ??= []
    fs.writeFileSync(fp, JSON.stringify(obj, ...jsonArgs))
  }

  // const pairFactory = new web3.eth.Contract(
  //   loadJson('./abis/pair-factory.json'),
  //   '0xA818b4F111Ccac7AA31D0BCc0806d64F2E0737D7'
  // )
  //
  // const unipoolFactoryAbi = loadJson('./abis/unipool-factory.json')
  // const uniFarmFactories = [
  //   '0xE29DCD715D11455194D7d74c622F3c42C8a37040',
  //   '0x78727c026957cB7fe67D0Fd404E55976Db9F0586'
  // ].map((address) => new web3.eth.Contract(unipoolFactoryAbi, address))

  const loadPair = async (pairAddress) => {
    const pair = new web3.eth.Contract(loadJson('./abis/pair-abi.json'), pairAddress)
    pair.token0 = await pair.methods.token0().call()
    pair.token1 = await pair.methods.token1().call()
    return pair
  }

  const gql = (queryParts, ...args) => {
    let resStr = queryParts[0]

    args.forEach((arg, index) => {
      resStr += `${arg}${queryParts[index + 1]}`
    })

    return resStr
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
    console.log('')
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

  /* I'm in UTC +2 so I need to shift the time by 14h to change 0000 UTC +2 ->
1200 UTC*/
  const LOCAL_TIME_SHIFT = 14

  const decodeDate = (date) => {
    const [day, month, year] = date.split('-').map((num) => +num)
    return Math.round(new Date(year, month - 1, day, LOCAL_TIME_SHIFT).getTime() / 1000)
  }

  const div2 = (x) => Math.ceil(x / 2)

  const binaryBlockTimestampSearch = async (targetTimestamp, pos, shift, comingFromDown) => {
    const { timestamp } = await web3.eth.getBlock(pos)
    if (timestamp === targetTimestamp) return pos
    if (shift === 1 && comingFromDown !== null) return pos
    const goingUp = timestamp < targetTimestamp
    return await binaryBlockTimestampSearch(
      targetTimestamp,
      goingUp ? pos + shift : pos - shift,
      div2(shift),
      shift === 1 ? goingUp : null
    )
  }

  const cachedHeights = {}

  const getBlockHeightFromDate = async (date) => {
    const cachedHeight = cachedHeights[date]
    if (cachedHeight !== undefined) return cachedHeight
    const timestamp = decodeDate(date)
    const totalBlocks = (await web3.eth.getBlockNumber()) + 1
    const midBlock = Math.floor(totalBlocks / 2)
    const initialShift = div2(midBlock)
    const height = await binaryBlockTimestampSearch(timestamp, midBlock, initialShift, null)
    cachedHeights[date] = height
    return height
  }

  const getHighestBlock = async (Transfer, pairAddress) => {
    const res = await Transfer.aggregate([
      { $group: { _id: { pair: '$pair' }, highestBlock: { $max: '$blockNumber' } } },
      { $match: { _id: { pair: pairAddress } } }
    ])
    return res[0]
  }

  return {
    gql,
    loadJson,
    saveJson,
    getPastLogs,
    // pairFactory,
    // uniFarmFactories,
    loadPair,
    ether,
    removeDuplicateTransfers,
    getHighestBlock,
    getDuplicates,
    constants: {
      ZERO_ADDRESS,
      SCALE
    },
    getBlockHeightFromDate
  }
}
