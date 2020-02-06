const utils = require('@gnosis.pm/safe-contracts/test/utils/general')

const GnosisSafe = artifacts.require("./GnosisSafe.sol")
const ProxyFactory = artifacts.require("./ProxyFactory.sol")
const TestToken = artifacts.require("./TestToken.sol")
const TestExchange = artifacts.require("./TestExchange.sol")
const MultiSend = artifacts.require("./MultiSend.sol")

contract('GnosisSafe', function(accounts) {
    let lw
    let gnosisSafeMasterCopy
    let proxyFactory
    let testToken
    let testExchange
    let multiSend

    const CALL = 0
    const ADDRESS_0 = "0x0000000000000000000000000000000000000000"

    beforeEach(async function() {
        // Create lightwallet
        lw = await utils.createLightwallet()

        gnosisSafeMasterCopy = await GnosisSafe.new()
        proxyFactory = await ProxyFactory.new()
        multiSend = await MultiSend.new()
        testToken = await TestToken.new()
        testExchange = await TestExchange.new(testToken.address)
    })

    let execTransaction = async function(safe, to, value, data, operation, message) {
        let nonce = await safe.nonce()
        let transactionHash = await safe.getTransactionHash(to, value, data, operation, 0, 0, 0, ADDRESS_0, ADDRESS_0, nonce)
        let sigs = utils.signTransaction(lw, [lw.accounts[0], lw.accounts[1]], transactionHash)
        utils.logGasUsage(
            'execTransaction ' + message,
            await safe.execTransaction(to, value, data, operation, 0, 0, 0, ADDRESS_0, ADDRESS_0, sigs)
        )
    }

    let execTransactionData = async function(owner, to, value, data, operation = 0) {
        let sigs = "0x" + "000000000000000000000000" + owner.replace('0x', '') + "0000000000000000000000000000000000000000000000000000000000000000" + "01"
        return await gnosisSafeMasterCopy.contract.methods.execTransaction(
            to, value, data, operation, 0, 0, 0, ADDRESS_0, ADDRESS_0, sigs
        ).encodeABI()
    }

    let deploySafe = async function(owners, threshold) {
        //console.log("Deploy Safe for", owners)
        const initData = await gnosisSafeMasterCopy.contract.methods.setup(owners, threshold, ADDRESS_0, "0x", ADDRESS_0, ADDRESS_0, 0, ADDRESS_0).encodeABI()
        //console.log("Init data", initData)
        return await getParamFromTxEvent(
            await proxyFactory.createProxy(gnosisSafeMasterCopy.address, initData),
            'ProxyCreation', 'proxy', proxyFactory.address, GnosisSafe, "create Gnosis Safe"
        )
    }

    let encodeMultiSend = async function(txs) {
        return await multiSend.contract.methods.multiSend(
            `0x${txs.map((tx) => [
              web3.eth.abi.encodeParameter('uint8', tx.operation).slice(-2),
              web3.eth.abi.encodeParameter('address', tx.to).slice(-40),
              web3.eth.abi.encodeParameter('uint256', tx.value).slice(-64),
              web3.eth.abi.encodeParameter('uint256', web3.utils.hexToBytes(tx.data).length).slice(-64),
              tx.data.replace(/^0x/, ''),
            ].join('')).join('')}`,
          ).encodeABI()
    }

    it('Use many safes with dfusion', async () => {
        const masterSafe = await deploySafe([lw.accounts[0], lw.accounts[1]], 2)
        console.log("Master Safe", masterSafe.address)
        const slaveSafes = []
        for (let i = 0; i < 40; i++) {
            const newSafe = await deploySafe([masterSafe.address], 1)
            console.log("Slave Safe", newSafe.address)
            await testToken.transfer(newSafe.address, 10 + i)
            console.log(await testToken.balanceOf(newSafe.address))
            slaveSafes.push(newSafe.address)
        }
        console.log("Slave Safes", slaveSafes)
        const transactions = []
        for (let index = 0; index < slaveSafes.length; index++) {
            const slaveSafe = slaveSafes[index]
            const tokenAmount = index + 2
            const transferData = await testToken.contract.methods.transfer(slaveSafe, tokenAmount).encodeABI()
            transactions.push({operation: 0, to: testToken.address, value: 0, data: transferData})
            const approveData = await testToken.contract.methods.approve(testExchange.address, tokenAmount).encodeABI()
            const depositData = await testExchange.contract.methods.deposit(tokenAmount).encodeABI()
            const multiSendData = await encodeMultiSend([
                {operation: 0, to: testToken.address, value: 0, data: approveData},
                {operation: 0, to: testExchange.address, value: 0, data: depositData}
            ])
            const execData = await execTransactionData(masterSafe.address, multiSend.address, 0, multiSendData, 1)
            transactions.push({operation: 0, to: slaveSafe, value: 0, data: execData})
        }
        const finalData = await encodeMultiSend(transactions)
        await execTransaction(masterSafe, multiSend.address, 0, finalData, 1, "deposit for all slaves")
        for (let index = 0; index < slaveSafes.length; index++) {
            const slaveSafe = slaveSafes[index]
            console.log("Slave", index, "(", slaveSafe, ") deposit:", await testExchange.deposits(slaveSafe))
            console.log("Slave", index, "(", slaveSafe, ") balance:", await testToken.balanceOf(slaveSafe))
        }
    })

    // Need some small adjustments to default implementation for web3js 1.x
    async function getParamFromTxEvent(transaction, eventName, paramName, contract, contractFactory, subject) {
        assert.isObject(transaction)
        if (subject != null) {
            utils.logGasUsage(subject, transaction)
        }
        let logs = transaction.logs
        if(eventName != null) {
            logs = logs.filter((l) => l.event === eventName && l.address === contract)
        }
        assert.equal(logs.length, 1, 'too many logs found!')
        let param = logs[0].args[paramName]
        if(contractFactory != null) {
            // Adjustment: add await
            let contract = await contractFactory.at(param)
            assert.isObject(contract, `getting ${paramName} failed for ${param}`)
            return contract
        } else {
            return param
        }
    }
})