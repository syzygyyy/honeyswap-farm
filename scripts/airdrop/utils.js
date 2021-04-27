module.exports = (web3) => {
  const fs = require('fs')

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

  return { loadJson, saveJson, getPastLogs, factory, loadPair }
}
