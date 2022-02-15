import { MultiAsset, TransactionOutputs, TransactionUnspentOutput } from '@emurgo/cardano-serialization-lib-asmjs'
import { Buffer } from 'buffer'

type Endpoints = {
    isEnabled : () => Promise<boolean>,
    enable : () => Promise<void>,
    getAddress : () => Promise<string>,
    getAddressHex : () => Promise<string>,
    getRewardAddress : () => Promise<string>,
    getRewardAddressHex : () => Promise<string>,
    getNetworkId : () => Promise<{
        id: number,
        network: string
    }>,
    getUtxos: () => Promise<Utxo[]>,
    getAssets: () => Promise<Asset[]>,
    getUtxosHex: () => Promise<string[]>,
    send: (data: Send) => Promise<string>,
    sendMultiple: (data: SendMultiple) => Promise<string>,

    auxiliary: Auxiliary
}

type Utxo = {
    txHash: string,
    txId: number,
    amount: Asset[]
}

type Asset = {
    unit: string,
    quantity: string
}

type Send = {
    address: string,
    amount?: number,
    assets?: Asset[],
    metadata?: any,
    metadataLabel?: string
}

type SendMultiple = {
    recipients: {
        address: string,
        amount?: number,
        assets?: Asset[]
    }[],
    metadata?: any,
    metadataLabel?: string
}

type ProtocolParameter = {
  linearFee: {
    minFeeA: string,
    minFeeB: string,
  },
  minUtxo: '1000000',
  poolDeposit: string,
  keyDeposit: string,
  maxTxSize: number,
  slot: number,
}

type Auxiliary = {
    Buffer: object,
    AsciiToBuffer: (string : string) => Buffer,
    HexToBuffer: (string : string) => Buffer,
    AsciiToHex: (string : string) => string,
    HexToAscii: (string : string) => string,
    BufferToAscii: (buffer : Buffer) => string,
    BufferToHex: (buffer : Buffer) => string,
}
enum WalletType {
  NAMI,
  CCVAULT,
}

const ERROR = {
    FAILED_PROTOCOL_PARAMETER: 'NO PROTOCOL PARAMS PASSED',
    TX_TOO_BIG: 'Transaction too big'
}

export async function WalletApi(walletObject: any, protocolParameterObject: ProtocolParameter, type: WalletType, serializationLib?: any, ) : Promise<Endpoints> {
    const serialize = serializationLib || await import('@emurgo/cardano-serialization-lib-asmjs')

    const Buffer = (await import('buffer')).Buffer
    const wallet = walletObject;
    const protocolParameter = protocolParameterObject;

    const CoinSelection = (await import('./coinSelection')).default

    const typeOfwallet = (type: WalletType) => {
        const walletObject = {
            [WalletType.NAMI]: wallet.nami,
            [WalletType.CCVAULT]: wallet.ccvault
        }

        return walletObject[type];
    };

    const selectedWallet = typeOfwallet(type);

    async function isEnabled() : Promise<boolean>{
        return await selectedWallet.isEnabled()
    }

    async function enable() : Promise<void>{
        if(!await isEnabled()) {
            try {
                await selectedWallet.enable()
            } catch (error) {
                throw error
            }
        }
    }

    async function getAddress() : Promise<string>{
        return serialize.Address.from_bytes(
            Buffer.from(
                await getAddressHex(),
                'hex'
            )
        ).to_bech32()
    }

    async function getAddressHex() : Promise<string>{
        return await wallet.getChangeAddress()
    }

    async function getRewardAddress() : Promise<string>{
        return serialize.RewardAddress.from_address(
            serialize.Address.from_bytes(
                Buffer.from(
                    await getRewardAddressHex(),
                    'hex'
                )
            )
        )?.to_address().to_bech32()
    }

    async function getRewardAddressHex() : Promise<string> {
        return await wallet.getRewardAddress()
    }

    async function getNetworkId() : Promise<{id: number, network: string}>{
        let networkId = await wallet.getNetworkId()
        return {
            id: networkId,
            network: networkId == 1 ? 'mainnet' : 'testnet'
        }
    }

    async function getUtxos() : Promise<Utxo[]> {
        let Utxos = (await getUtxosHex()).map(u => serialize.TransactionUnspentOutput.from_bytes(
                Buffer.from(
                    u,
                    'hex'
                )
            )
        )
        let UTXOS = []
        for(let utxo of Utxos){
            let assets = _utxoToAssets(utxo)

            UTXOS.push({
                txHash: Buffer.from(
                    utxo.input().transaction_id().to_bytes(),
                    'hex'
                  ).toString('hex'),
                txId: utxo.input().index(),
                amount: assets
            })
        }
        return UTXOS
    }

    async function getAssets() : Promise<Asset[]> {
        let Utxos = await getUtxos()
        let AssetsRaw : Asset[] = []
        Utxos.forEach(u => {
            AssetsRaw.push(...u.amount.filter(a => a.unit != 'lovelace'))
        })
        let AssetsMap : any = {}

        for(let k of AssetsRaw){
            let quantity = parseInt(k.quantity)
            if(!AssetsMap[k.unit]) AssetsMap[k.unit] = 0
            AssetsMap[k.unit] += quantity
        }
        return Object.keys(AssetsMap).map(k => ({unit: k, quantity: AssetsMap[k].toString()}))
    }

    async function getUtxosHex() : Promise<string[]> {
        return await wallet.getUtxos()
    }

    async function send({address, amount = 0, assets = [], metadata = null, metadataLabel = '721'} : Send) : Promise<string> {
        let PaymentAddress = await getAddress()

        let utxos = (await getUtxosHex()).map(u => serialize.TransactionUnspentOutput.from_bytes(
            Buffer.from(
                u,
                'hex'
            )
        ))

        let lovelace = Math.floor(amount * 1000000).toString()

        let ReceiveAddress = address


        let multiAsset = _makeMultiAsset(assets)

        let outputValue = serialize.Value.new(
            serialize.BigNum.from_str(lovelace)
        )

        if(assets.length > 0)outputValue.set_multiasset(multiAsset)

        let minAda = serialize.min_ada_required(
            outputValue,
            serialize.BigNum.from_str(protocolParameter.minUtxo || "1000000")
        )
        if(serialize.BigNum.from_str(lovelace).compare(minAda) < 0)outputValue.set_coin(minAda)


        let outputs = serialize.TransactionOutputs.new()
        outputs.add(
            serialize.TransactionOutput.new(
                serialize.Address.from_bech32(ReceiveAddress),
                outputValue
            )
        )

        let RawTransaction = _txBuilder({
            PaymentAddress: PaymentAddress,
            Utxos: utxos,
            Outputs: outputs,
            ProtocolParameter: protocolParameter,
            Metadata: metadata,
            MetadataLabel: metadataLabel,
            Delegation: null
        })

        return await _signSubmitTx(RawTransaction)
    }

    async function sendMultiple({recipients = [], metadata = null, metadataLabel = '721'}: SendMultiple) : Promise<string> {
        let PaymentAddress = await getAddress()

        let utxos = (await getUtxosHex()).map(u => serialize.TransactionUnspentOutput.from_bytes(
            Buffer.from(
                u,
                'hex'
            )
        ))

        let outputs = serialize.TransactionOutputs.new()

        for (let recipient of recipients){
            let lovelace = Math.floor((recipient.amount || 0) * 1000000).toString()
            let ReceiveAddress = recipient.address
            let multiAsset = _makeMultiAsset(recipient.assets || [])

            let outputValue = serialize.Value.new(
                serialize.BigNum.from_str(lovelace)
            )

            if((recipient.assets || []).length > 0) outputValue.set_multiasset(multiAsset)

            let minAda = serialize.min_ada_required(
                outputValue,
                serialize.BigNum.from_str(protocolParameter.minUtxo || "1000000")
            )
            if(serialize.BigNum.from_str(lovelace).compare(minAda) < 0)outputValue.set_coin(minAda)


            outputs.add(
                serialize.TransactionOutput.new(
                    serialize.Address.from_bech32(ReceiveAddress),
                    outputValue
                )
            )
        }

        let RawTransaction = _txBuilder({
            PaymentAddress: PaymentAddress,
            Utxos: utxos,
            Outputs: outputs,
            ProtocolParameter: protocolParameter,
            Metadata: metadata,
            MetadataLabel: metadataLabel,
            Delegation: null
        })

        return await _signSubmitTx(RawTransaction)
    }

    async function signData(string : string) : Promise<string> {
        let address = await getAddressHex()
        let coseSign1Hex = await wallet.signData(
            address,
            Buffer.from(
                string,
                "ascii"
            ).toString('hex')
        )
        return coseSign1Hex
    }

    //////////////////////////////////////////////////
    //Auxiliary

    function AsciiToBuffer(string : string) : Buffer{
        return Buffer.from(string, "ascii")
    }

    function HexToBuffer(string: string) : Buffer{
        return Buffer.from(string, "hex")
    }

    function AsciiToHex(string: string) : string{
        return AsciiToBuffer(string).toString('hex')
    }

    function HexToAscii(string: string) : string{
        return HexToBuffer(string).toString("ascii")
    }

    function BufferToAscii(buffer: Buffer) : string{
        return buffer.toString('ascii')
    }

    function BufferToHex(buffer: Buffer) : string{
        return buffer.toString("hex")
    }

    //////////////////////////////////////////////////

    function _makeMultiAsset(assets : Asset[]) : MultiAsset{
        let AssetsMap : any = {}
        for(let asset of assets){
            let [policy, assetName] = asset.unit.split('.')
            let quantity = asset.quantity
            if(!Array.isArray(AssetsMap[policy])){
                AssetsMap[policy] = []
            }
            AssetsMap[policy].push({
                "unit": Buffer.from(assetName, 'ascii').toString('hex'),
                "quantity": quantity
            })

        }
        let multiAsset = serialize.MultiAsset.new()
        for(const policy in AssetsMap){

            const ScriptHash = serialize.ScriptHash.from_bytes(
                Buffer.from(policy,'hex')
            )
            const Assets = serialize.Assets.new()

            const _assets = AssetsMap[policy]

            for(const asset of _assets){
                const AssetName = serialize.AssetName.new(Buffer.from(asset.unit,'hex'))
                const BigNum = serialize.BigNum.from_str(asset.quantity)

                Assets.insert(AssetName, BigNum)
            }
            multiAsset.insert(ScriptHash, Assets)
        }
        return multiAsset
    }

    function _utxoToAssets(utxo: TransactionUnspentOutput) : Asset[]{
        let value : any = utxo.output().amount()
        const assets = [];
        assets.push({ unit: 'lovelace', quantity: value.coin().to_str() });
        if (value.multiasset()) {
            const multiAssets = value.multiasset().keys();
            for (let j = 0; j < multiAssets.len(); j++) {
            const policy = multiAssets.get(j);
            const policyAssets = value.multiasset().get(policy);
            const assetNames = policyAssets.keys();
            for (let k = 0; k < assetNames.len(); k++) {
                const policyAsset = assetNames.get(k);
                const quantity = policyAssets.get(policyAsset);
                const asset =
                    Buffer.from(
                        policy.to_bytes()
                    ).toString('hex') + "." +
                    Buffer.from(
                        policyAsset.name()
                    ).toString('ascii')


                assets.push({
                    unit: asset,
                    quantity: quantity.to_str(),
                });
            }
            }
        }
        return assets;
    }

    function _txBuilder({PaymentAddress, Utxos, Outputs, ProtocolParameter, Metadata = null, MetadataLabel = '721', Delegation = null} : {
        PaymentAddress : string
        Utxos : any,
        Outputs : TransactionOutputs,
        ProtocolParameter : ProtocolParameter,
        Metadata? : any,
        MetadataLabel?: string,
        Delegation? : {
            stakeKeyHash: string,
            poolHex: string,
            delegation: {
                active: boolean,
                rewards: string,
                poolId: string
            }
        } | null
    }) : Uint8Array {
        const MULTIASSET_SIZE = 5000;
        const VALUE_SIZE = 5000;
        const totalAssets = 0
        CoinSelection.setLoader(serialize)
        CoinSelection.setProtocolParameters(
            ProtocolParameter.minUtxo.toString(),
            ProtocolParameter.linearFee.minFeeA.toString(),
            ProtocolParameter.linearFee.minFeeB.toString(),
            ProtocolParameter.maxTxSize.toString()
        )
        const selection = CoinSelection.randomImprove(
            Utxos,
            Outputs,
            20 + totalAssets,
            //ProtocolParameter.minUtxo.to_str()
        )
        const inputs = selection.input;
        const txBuilder = serialize.TransactionBuilder.new(
            serialize.LinearFee.new(
                serialize.BigNum.from_str(ProtocolParameter.linearFee.minFeeA),
                serialize.BigNum.from_str(ProtocolParameter.linearFee.minFeeB)
            ),
            serialize.BigNum.from_str(ProtocolParameter.minUtxo.toString()),
            serialize.BigNum.from_str(ProtocolParameter.poolDeposit.toString()),
            serialize.BigNum.from_str(ProtocolParameter.keyDeposit.toString()),
            MULTIASSET_SIZE,
            MULTIASSET_SIZE
        );

        for (let i = 0; i < inputs.length; i++) {
            const utxo = inputs[i];
            txBuilder.add_input(
              utxo.output().address(),
              utxo.input(),
              utxo.output().amount()
            );
        }

        if(Delegation){
            let certificates = serialize.Certificates.new();
            if (!Delegation.delegation.active){
                certificates.add(
                    serialize.Certificate.new_stake_registration(
                        serialize.StakeRegistration.new(
                            serialize.StakeCredential.from_keyhash(
                                serialize.Ed25519KeyHash.from_bytes(
                                    Buffer.from(Delegation.stakeKeyHash, 'hex')
                                )
                            )
                        )
                    )
                )
            }

            let poolKeyHash = Delegation.poolHex
            certificates.add(
                serialize.Certificate.new_stake_delegation(
                  serialize.StakeDelegation.new(
                    serialize.StakeCredential.from_keyhash(
                      serialize.Ed25519KeyHash.from_bytes(
                        Buffer.from(Delegation.stakeKeyHash, 'hex')
                      )
                    ),
                    serialize.Ed25519KeyHash.from_bytes(
                      Buffer.from(poolKeyHash, 'hex')
                    )
                  )
                )
            );
            txBuilder.set_certs(certificates)
        }


        let AUXILIARY_DATA
        if(Metadata){
            let METADATA = serialize.GeneralTransactionMetadata.new()
            METADATA.insert(
                serialize.BigNum.from_str(MetadataLabel),
                serialize.encode_json_str_to_metadatum(
                    JSON.stringify(Metadata),
                    0
                )
            )
            AUXILIARY_DATA = serialize.AuxiliaryData.new()
            AUXILIARY_DATA.set_metadata(METADATA)
            //const auxiliaryDataHash = serialize.hash_auxiliary_data(AUXILIARY_DATA)
            txBuilder.set_auxiliary_data(AUXILIARY_DATA)
        }

        for(let i=0; i<Outputs.len(); i++){
            txBuilder.add_output(Outputs.get(i))
        }


        const change = selection.change;
        const changeMultiAssets = change.multiasset();
        // check if change value is too big for single output
        if (changeMultiAssets && change.to_bytes().length * 2 > VALUE_SIZE) {
            const partialChange = serialize.Value.new(
                serialize.BigNum.from_str('0')
            );

            const partialMultiAssets = serialize.MultiAsset.new();
            const policies = changeMultiAssets.keys();
            const makeSplit = () => {
                for (let j = 0; j < changeMultiAssets.len(); j++) {
                  const policy = policies.get(j);
                  const policyAssets = changeMultiAssets.get(policy);
                  const assetNames = policyAssets.keys();
                  const assets = serialize.Assets.new();
                  for (let k = 0; k < assetNames.len(); k++) {
                    const policyAsset = assetNames.get(k);
                    const quantity = policyAssets.get(policyAsset);
                    assets.insert(policyAsset, quantity);
                    //check size
                    const checkMultiAssets = serialize.MultiAsset.from_bytes(
                      partialMultiAssets.to_bytes()
                    );
                    checkMultiAssets.insert(policy, assets);
                    const checkValue = serialize.Value.new(
                      serialize.BigNum.from_str('0')
                    );
                    checkValue.set_multiasset(checkMultiAssets);
                    if (
                      checkValue.to_bytes().length * 2 >=
                      VALUE_SIZE
                    ) {
                      partialMultiAssets.insert(policy, assets);
                      return;
                    }
                  }
                  partialMultiAssets.insert(policy, assets);
                }
              };

            makeSplit();
            partialChange.set_multiasset(partialMultiAssets);

            const minAda = serialize.min_ada_required(
                partialChange,
                serialize.BigNum.from_str(ProtocolParameter.minUtxo)
            );
            partialChange.set_coin(minAda);

            txBuilder.add_output(
                serialize.TransactionOutput.new(
                serialize.Address.from_bech32(PaymentAddress),
                partialChange
                )
            );
        }
        txBuilder.add_change_if_needed(
            serialize.Address.from_bech32(PaymentAddress)
        );
        const transaction = serialize.Transaction.new(
            txBuilder.build(),
            serialize.TransactionWitnessSet.new(),
            AUXILIARY_DATA
        )

        const size = transaction.to_bytes().length * 2;
        if (size > ProtocolParameter.maxTxSize) throw ERROR.TX_TOO_BIG;

        return transaction.to_bytes()
    }

    async function _signSubmitTx(transactionRaw : Uint8Array) : Promise<string>{
        let transaction = serialize.Transaction.from_bytes(transactionRaw)
        const witneses = await wallet.signTx(
            Buffer.from(
                transaction.to_bytes()
            ).toString('hex')
        )

        const signedTx = serialize.Transaction.new(
            transaction.body(),
            serialize.TransactionWitnessSet.from_bytes(
                Buffer.from(
                    witneses,
                    "hex"
                )
            ),
            transaction.auxiliary_data()
        )

        const txhash = await wallet.submitTx(
            Buffer.from(
                signedTx.to_bytes()
            ).toString('hex')
        )
        return txhash

    }
    return {
        isEnabled,
        enable,
        getAddress,
        getAddressHex,
        getRewardAddress,
        getRewardAddressHex,
        getNetworkId,
        getUtxos,
        getAssets,
        getUtxosHex,
        send,
        sendMultiple,
        auxiliary: {
            Buffer: Buffer,
            AsciiToBuffer: AsciiToBuffer,
            HexToBuffer: HexToBuffer,
            AsciiToHex: AsciiToHex,
            HexToAscii: HexToAscii,
            BufferToAscii: BufferToAscii,
            BufferToHex: BufferToHex,
        }
    }
}
