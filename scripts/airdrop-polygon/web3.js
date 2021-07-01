module.exports = () => {
  require('dotenv').config()
  const Web3 = require('web3')

  const web3 = new Web3(
    new Web3.providers.WebsocketProvider(process.env.MATIC_PROVIDER, {
      clientConfig: {
        maxReceivedFrameSize: 10000000000,
        maxReceivedMessageSize: 10000000000
      }
    })
  )
  web3.chain = 'polygon'
  return web3
  // return new Web3(new Web3.providers.HttpProvider('https://rpc.xdaichain.com/'))
}
