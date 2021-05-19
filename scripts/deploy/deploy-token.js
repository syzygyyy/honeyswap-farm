const { web3, mainAddr } = require('./web3')()
const { deploy, loadJson } = require('./utils')
const XDaiCombTokenData = require('../../build/contracts/XDaiCombToken.json')
const StreamedAirdropperData = require('../../build/contracts/StreamedAirdropper.json')
const { safeBN, ether } = require('../../test/utils')(web3)
const BN = require('bn.js')
require('dotenv').config()

const GAS_PRICE = '1000000000'

async function main() {
  console.log('account executing: ', mainAddr)
  const addresses = loadJson('../../addresses.json')
  const MainTokenData = XDaiCombTokenData
  let startingNonce = await web3.eth.getTransactionCount(mainAddr)
  console.log('startingNonce: ', startingNonce)

  const [, , rawUpfrontDist, rawTotalVestingTime, airdropSnapshotSrc, rawBatchSize] = process.argv
  const upfrontReward = parseFloat(rawUpfrontDist)
  const totalVestingTime = parseInt(rawTotalVestingTime)
  const batchSize = parseInt(rawBatchSize)

  const currentTime = Math.floor(new Date() / 1000)
  const startTime = currentTime - (totalVestingTime * upfrontReward) / (1 - upfrontReward)
  const endTime = currentTime + totalVestingTime

  const HSFToken = new web3.eth.Contract(MainTokenData.abi)
  let hsfToken
  if (addresses.xdai.hsfToken) {
    hsfToken = new web3.eth.Contract(MainTokenData.abi, addresses.xdai.hsfToken)
  } else {
    console.log('deploying token')
    const { contract: contract1 } = await deploy(
      HSFToken.deploy({ data: MainTokenData.bytecode })
        .send({
          from: mainAddr,
          nonce: startingNonce++,
          gas: 1000000,
          gasPrice: GAS_PRICE
        })
        .on('sending', () => console.log('sending'))
        .on('sent', () => console.log('tx was sent'))
        .on('transactionHash', (tx) => console.log('tx: ', tx))
    )
    hsfToken = contract1
    console.log(`deployed token at ${hsfToken.options.address}`)
  }

  let airdropper
  if (addresses.xdai.airdropper) {
    airdropper = new web3.eth.Contract(StreamedAirdropperData.abi, addresses.xdai.airdropper)
  } else {
    const StreamedAirdropper = new web3.eth.Contract(StreamedAirdropperData.abi)
    const { contract: contract2 } = await deploy(
      StreamedAirdropper.deploy({
        data: StreamedAirdropperData.bytecode,
        arguments: [hsfToken.options.address, safeBN(startTime), safeBN(endTime)]
      })
        .send({
          from: mainAddr,
          nonce: startingNonce++,
          gas: 1000000,
          gasPrice: GAS_PRICE
        })
        .on('sending', () => console.log('sending'))
        .on('sent', () => console.log('tx was sent'))
        .on('transactionHash', (tx) => console.log('tx: ', tx))
    )
    airdropper = contract2
    console.log(`deployed airdropper at ${airdropper.options.address}`)
  }

  if (hsfToken.options.address !== (await airdropper.methods.token().call()))
    throw new Error('instance mismatch')

  const ONE = new BN('1')
  const maxAllowance = ONE.shln(256).sub(ONE)
  const requiredAllowance = ether('50000')
  if (
    requiredAllowance.lt(
      new BN(await hsfToken.methods.allowance(mainAddr, airdropper.options.address))
    )
  )
    await hsfToken.methods
      .approve(airdropper.options.address, maxAllowance)
      .send({ from: mainAddr, nonce: startingNonce++, gasPrice: GAS_PRICE, gas: 200000 })

  const snapshot = loadJson(airdropSnapshotSrc)
  const allRecipients = Object.entries(snapshot)
  const totalRecipients = allRecipients.length

  for (let i = 0; i * batchSize < totalRecipients; i++) {
    const batch = allRecipients.slice(i * batchSize, (i + 1) * batchSize)
    const batchRecipients = batch.map(([recipient]) => recipient)
    const batchAmounts = batch.map(([, amount]) => new BN(amount, 16))
    await airdropper.methods
      .addVesting(batchRecipients, batchAmounts)
      .send({
        from: mainAddr,
        nonce: startingNonce++,
        gasPrice: GAS_PRICE,
        gas: Math.max(batchSize * 30000, 4000000)
      })
      .on('sending', () => console.log('sending'))
      .on('sent', () => console.log('tx was sent'))
      .on('transactionHash', (tx) => console.log('tx: ', tx))
    console.log(`${Math.min((i + 1) * batchSize, totalRecipients)}/${totalRecipients}`)
  }

  const leftOver = await hsfToken.methods.balanceOf(mainAddr).call()
  await hsfToken.methods.transfer(process.env.SECURE_DEST, leftOver).send({
    from: mainAddr,
    nonce: startingNonce++,
    gasPrice: GAS_PRICE,
    gas: 200000
  })

  console.log(`deployed token at ${hsfToken.options.address}`)
  console.log(`deployed airdropper at ${airdropper.options.address}`)
  console.log(`airdropped ${totalRecipients} addresses`)
  console.log(`remaining xComb tokens transferred to ${process.env.SECURE_DEST}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.log(err)
    throw new Error(
      'required parameters: [upfront percentage] [total vesting time (s)] [snapshot src] [batch size]'
    )
  })
