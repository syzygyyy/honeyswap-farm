const Web3 = require('web3')
const HoneyFarmData = require('../build/contracts/HoneyFarm.json')
const ReferralRewarderData = require('../build/contracts/ReferralRewarder.json')
const BN = require('bn.js')
require('dotenv').config()

async function main() {
  const MAX_UINT256 = new BN('1').shln(256).sub(new BN('1'))

  const privKey = process.env.ACCOUNT0_PRIVATE_KEY
  if (!privKey) throw new Error('please set a private key')
  const provider = process.env.WEB3_ENDPOINT
  if (!provider) throw new Error('please set a provider')
  const web3 = new Web3(new Web3.providers.WebsocketProvider(provider))

  const { getDetAddr, ether, safeBN } = require('../test/utils')(web3)

  const account = web3.eth.accounts.wallet.add(privKey)
  const mainAddr = account.address
  console.log('mainAddr: ', mainAddr)
  process.exit(0)

  // deploy xComb token
  const EmptyHSFToken = new web3.eth.Contract(HSFTokenData.abi)
  const { contract: hsfToken } = await deploy(
    EmptyHSFToken.deploy({ data: HSFTokenData.bytecode }).send({
      from: mainAddr,
      gas: 4000000,
      gasPrice: '1000000000'
    })
  )
  console.log(`xCOMB token deployed at ${hsfToken.options.address}`)

  // approve spend
  const nonce = (await web3.eth.getTransactionCount(mainAddr)) - 1
  await hsfToken.methods.approve(getDetAddr(mainAddr, nonce + 2), MAX_UINT256).send({
    from: mainAddr,
    gas: 150000,
    gasPrice: '1000000000'
  })

  // deploy farm
  const SCALE = ether('1')

  const totalSupply = ether('1000000')
  const airdropPerc = ether('0.05')
  const referrerRewardPerc = ether('0.01')
  const endDistFrac = ether('0.25')
  const downgradeFee = ether('0.0001')
  const minimumTimelock = safeBN(24 * 60 * 60) // 1 day
  const maximumTimelock = safeBN(Math.floor(1.5 * 365 * 24 * 60 * 60)) // 1.5 years

  const airdrop = totalSupply.mul(airdropPerc).div(SCALE)
  const leftOver = totalSupply.sub(airdrop)
  const totalReferrerReward = leftOver.mul(referrerRewardPerc).div(SCALE)
  const distRewards = leftOver.sub(totalReferrerReward)

  const EmptyHoneyFarm = new web3.eth.Contract(HoneyFarmData.abi)
  const args = [
    hsfToken.options.address,
    [
      safeBN(currentTime),
      safeBN(currentTime + 2 * 365 * 24 * 60 * 60),
      distRewards,
      endDistFrac,
      minimumTimelock,
      maximumTimelock,
      SCALE.div(safeBN(10 * 30 * 24 * 60 * 60)),
      SCALE,
      downgradeFee
    ]
  ]
  console.log('args: ', args)
  for (let subArg of args[1]) {
    console.log('subArg.toString(): ', subArg.toString(16))
  }

  const { contract: farm } = await deploy(
    EmptyHoneyFarm.deploy({
      data: HoneyFarmData.bytecode,
      arguments: [args[0], args[1].map((arg) => `0x${arg.toString(16)}`)]
    }).send({
      from: mainAddr,
      gas: 6000000,
      gasPrice: '1000000000'
    })
  )
  console.log(`farm deployed at ${farm.options.address}`)

  // deploy referral rewarder
  const EmptyReferralRewarder = new web3.eth.Contract(ReferralRewarderData.abi)
  const { contract: referralRewarder } = await deploy(
    EmptyReferralRewarder.deploy({
      data: ReferralRewarderData.bytecode,
      arguments: [hsfToken.options.address, referrerRewardPerc]
    }).send({
      from: mainAddr,
      gas: 4000000,
      gasPrice: '1000000000'
    })
  )
  console.log(`referral rewarder deployed at ${referralRewarder.options.address}`)

  // fill up with rewards
  await hsfToken.methods
    .transfer(referralRewarder.options.address, totalReferrerReward)
    .send({ from: mainAddr, gas: 300000, gasPrice: '1000000000' })

  // transfer ownership of referral rewarder to farm
  await referralRewarder.methods.transferOwnership(farm.options.address).send({
    from: mainAddr,
    gas: 300000,
    gasPrice: '1000000000'
  })

  // set rewarder in farm
  await farm.methods.setReferralRewarder(referralRewarder.options.address).send({
    from: mainAddr,
    gas: 300000,
    gasPrice: '1000000000'
  })
  console.log('complete')

  // in real deploy
  // await farm.methods.transferOwnership('<safe addr>').send({
  //   from: mainAddr,
  //   gas: 300000,
  //   gasPrice: '1000000000'
  // })
  //
}

main()
