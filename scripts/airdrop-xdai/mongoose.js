module.exports = (web3) => {
  require('dotenv').config()
  const {
    constants: { ZERO_ADDRESS }
  } = require('./utils')(web3)

  const mongoose = require('mongoose')
  const { Schema } = mongoose

  const connectDB = async () =>
    await mongoose.connect(process.env.DB_CONNECTION, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    })

  const isAddressValidator = () => ({
    validator: web3.utils.checkAddressChecksum,
    message: ({ value }) => `${value} is not a valid address`
  })

  const transferSchema = new Schema({
    blockNumber: Number,
    transactionHash: {
      type: String,
      validate: {
        validator: (txId) => web3.utils.isHexStrict(txId) && txId.length === 66,
        message: ({ value }) => `${value} is not valid transaction id`
      }
    },
    logIndex: Number,
    pair: { type: String, validate: isAddressValidator() },
    from: { type: String, validate: isAddressValidator() },
    to: { type: String, validate: isAddressValidator() },
    value: String
  })
  const Transfer = mongoose.model('Transfer', transferSchema)

  const addressSchema = new Schema({
    address: { type: String, validate: isAddressValidator(), index: true },
    isContract: Boolean
  })
  const Address = mongoose.model('Address', addressSchema)

  const isContract = async (address) => {
    if (address === ZERO_ADDRESS) return false
    address = web3.utils.toChecksumAddress(address)

    const dbRes = await Address.findOne({ address })
    if (dbRes === null) {
      const code = await web3.eth.getCode(address)
      const hasCode = code.length >= 4
      const newAddressEntry = new Address({ address, isContract: hasCode })
      newAddressEntry.save()
      return hasCode
    }
    return dbRes.isContract
  }

  const ASCENDING = 1
  const DESCENDING = -1

  return { connectDB, Transfer, isContract, Address, ASCENDING, DESCENDING }
}
