import { Contract, ZeroAddress, parseEther, parseUnits, getBytes, JsonRpcProvider, toBeHex } from "ethers";
import { ethers, utils } from 'ethersv5';
import { BaseTransaction } from '@safe-global/safe-apps-sdk';
import { getSafeInfo, isConnectedToSafe, submitTxs } from "./safeapp";
import { isModuleEnabled, buildEnableModule, buildUpdateFallbackHandler } from "./safe";
import { getJsonRpcProvider, getProvider } from "./web3";
import Safe7579 from "./Safe7579.json"
import EntryPoint from "./EntryPoint.json"
import {  publicClient } from "./utils";
import {  buildUnsignedUserOpTransaction } from "@/utils/userOp";
import {  Address, Hex, pad } from "viem";
import { ENTRYPOINT_ADDRESS_V07, getPackedUserOperation, UserOperation, getAccountNonce } from 'permissionless'
import { sendUserOperation } from "./permissionless";
import {
    getClient,
    getModule,
    getAccount,
    installModule,
    isModuleInstalled,
    getInstalledModules,
    ModuleType
  } from "@rhinestone/module-sdk";
import { NetworkUtil } from "./networks";
   

const safe7579Module = "0x94952C0Ea317E9b8Bca613490AF25f6185623284"
const ownableModule = "0xe90044FE8855B307Fe8F9848fd9558D5D3479191"
export function generateRandomString(length: number) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        result += characters.charAt(randomIndex);
    }
    return result;
}


/**
 * Generates a deterministic key pair from an arbitrary length string
 *
 * @param {string} string - The string to generate a key pair from
 * @returns {Object} - An object containing the address and privateKey
 */
export function generateKeysFromString(string: string) {
    const privateKey = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(string)) // v5
    const wallet = new ethers.Wallet(privateKey)
    return {
        address: wallet.address,
        privateKey: privateKey,
    }
}



export const sendTransaction = async (chainId: string, recipient: string, amount: bigint, walletProvider: any, safeAccount: string): Promise<any> => {

    const calls = [{ target: recipient as Hex, value: amount, callData: '0x' as Hex } ]

    const key = BigInt(pad(ownableModule as Hex, {
        dir: "right",
        size: 24,
      }) || 0
    )
    
    const nonce = await getAccountNonce(publicClient(parseInt(chainId)), {
        sender: safeAccount as Hex,
        entryPoint: ENTRYPOINT_ADDRESS_V07,
        key: key
    })

    let unsignedUserOp = buildUnsignedUserOpTransaction(
        safeAccount as Hex,
        calls,
        nonce,
      )

      const signUserOperation = async function signUserOperation(userOperation: UserOperation<"v0.7">) {

        const provider = await getJsonRpcProvider(chainId)
    
        const entryPoint = new Contract(
            ENTRYPOINT_ADDRESS_V07,
            EntryPoint.abi,
            provider
        )
        let typedDataHash = getBytes(await entryPoint.getUserOpHash(getPackedUserOperation(userOperation)))
        return await walletProvider.signMessage(typedDataHash) as `0x${string}`
    }

    const userOperationHash = await sendUserOperation(chainId, unsignedUserOp, signUserOperation )

    return userOperationHash;
}


const buildInitSafe7579 = async ( ): Promise<BaseTransaction> => {

    
    const info = await getSafeInfo()

    const provider = await getProvider()
    // Updating the provider RPC if it's from the Safe App.
    const chainId = (await provider.getNetwork()).chainId.toString()
    const bProvider = await getJsonRpcProvider(chainId)

    const safe7579 = new Contract(
        safe7579Module,
        Safe7579.abi,
        bProvider
    )

    return {
        to: safe7579Module,
        value: "0",
        data: (await safe7579.initializeAccount.populateTransaction([], [], [], [], {registry: ZeroAddress, attesters: [], threshold: 0})).data
    }
}




const buildInstallModule = async (address: Address, type: ModuleType, initData: Hex): Promise<BaseTransaction> => {

    const provider = await getProvider()
    const safeInfo = await getSafeInfo()
    
    // Updating the provider RPC if it's from the Safe App.
    const chainId = (await provider.getNetwork()).chainId.toString()

    const client = getClient({ rpcUrl: NetworkUtil.getNetworkById(parseInt(chainId))?.url!});

    // Create the account object
    const account = getAccount({
            address: safe7579Module,
            type: "safe",
        });



    const module = getModule({
        module: address,
        data: initData,
        type:  type ,
      });

    const executions = await installModule({
        client,
        account,
        module,
      });


      return {to: safeInfo.safeAddress , value: executions[0].value.toString() , data: executions[0].callData}

}


const isInstalled = async (address: Address, type: ModuleType): Promise<boolean> => {

    const provider = await getProvider()
    const safeInfo = await getSafeInfo()
    
    // Updating the provider RPC if it's from the Safe App.
    const chainId = (await provider.getNetwork()).chainId.toString()

    const client = getClient({ rpcUrl: NetworkUtil.getNetworkById(parseInt(chainId))?.url!});


    // Create the account object
    const account = getAccount({
            address: safeInfo.safeAddress as Hex,
            type: "safe",
        });


    const module = getModule({
        module: address,
        data: '0x',
        type:  type ,
      });

     
    try {  
    return await isModuleInstalled({
        client,
        account,
        module,
      });
    }
    catch {
        return false;
    }

}



export const addValidatorModule = async (ownerAddress: string ) => {
    
    if (!await isConnectedToSafe()) throw Error("Not connected to a Safe")

    const info = await getSafeInfo()

    const txs: BaseTransaction[] = []

    if (!await isModuleEnabled(info.safeAddress, safe7579Module)) {
        txs.push(await buildEnableModule(info.safeAddress, safe7579Module))
        txs.push(await buildUpdateFallbackHandler(info.safeAddress, safe7579Module))
        txs.push(await buildInitSafe7579())
        txs.push(await buildInstallModule(ownableModule, 'validator', utils.defaultAbiCoder.encode(['address'], [ownerAddress]) as Hex))
    }
    else if(!await isInstalled(ownableModule, 'validator')) {
        txs.push(await buildInstallModule(ownableModule, 'validator', utils.defaultAbiCoder.encode(['address'], [ownerAddress]) as Hex))

    }

    if (txs.length > 0)  
    await submitTxs(txs)
}
